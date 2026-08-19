/* ==========================================================================
   archive.js — reads the archive without external libraries.
   Exposes two implementations behind the same interface:
     ZipArchive    — reads a .zip file using DecompressionStream('deflate-raw')
     FolderArchive — reads an already extracted folder (webkitdirectory input)
   Shared interface:
     .entries  -> Array<{ name, base, size, dir }>
     .bytes(entry)  -> Promise<Uint8Array>
     .blob(entry, mime) -> Promise<Blob>
     .text(entry)  -> Promise<string>
   ========================================================================== */
(function (global) {
  'use strict';

  const SIG_EOCD   = 0x06054b50;
  const SIG_EOCD64 = 0x06064b50;
  const SIG_LOC64  = 0x07064b50;
  const SIG_CEN    = 0x02014b50;

  const utf8 = new TextDecoder('utf-8');

  /* ------------------------------------------------------------- helpers */
  async function slice(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }

  function view(u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }

  /** Inflate a raw deflate stream. Uses the browser's native API. */
  async function inflateRaw(compressed) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(global.I18n.t('e.nodecomp'));
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  /* --------------------------------------------------------- ZipArchive */
  class ZipArchive {
    constructor(file) {
      this.file = file;
      this.entries = [];
      this.name = file.name || 'archive.zip';
    }

    static isZip(file) {
      return /\.zip$/i.test(file.name || '') || file.type === 'application/zip'
          || file.type === 'application/x-zip-compressed';
    }

    async open() {
      const size = this.file.size;
      // The EOCD sits in the last 22 bytes, plus an optional comment (max 65535).
      const tailLen = Math.min(size, 66000);
      const tail = await slice(this.file, size - tailLen, size);
      const dv = view(tail);

      let eocd = -1;
      for (let i = tail.length - 22; i >= 0; i--) {
        if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error(global.I18n.t('e.badzip'));

      let count    = dv.getUint16(eocd + 10, true);
      let cdSize   = dv.getUint32(eocd + 12, true);
      let cdOffset = dv.getUint32(eocd + 16, true);

      // ZIP64: when one of these fields is maxed out, the real values live in the EOCD64.
      if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
        let loc = -1;
        for (let i = eocd - 20; i >= 0; i--) {
          if (dv.getUint32(i, true) === SIG_LOC64) { loc = i; break; }
        }
        if (loc >= 0) {
          const eocd64Off = Number(dv.getBigUint64(loc + 8, true));
          const h = await slice(this.file, eocd64Off, eocd64Off + 56);
          const hv = view(h);
          if (hv.getUint32(0, true) === SIG_EOCD64) {
            count    = Number(hv.getBigUint64(32, true));
            cdSize   = Number(hv.getBigUint64(40, true));
            cdOffset = Number(hv.getBigUint64(48, true));
          }
        }
      }

      const cd = await slice(this.file, cdOffset, cdOffset + cdSize);
      const cv = view(cd);
      const entries = [];
      let p = 0;
      while (p + 46 <= cd.length && entries.length < count + 8) {
        if (cv.getUint32(p, true) !== SIG_CEN) break;
        const flags     = cv.getUint16(p + 8, true);
        const method    = cv.getUint16(p + 10, true);
        const dosTime   = cv.getUint16(p + 12, true);
        const dosDate   = cv.getUint16(p + 14, true);
        let   compSize  = cv.getUint32(p + 20, true);
        let   fullSize  = cv.getUint32(p + 24, true);
        const nameLen   = cv.getUint16(p + 28, true);
        const extraLen  = cv.getUint16(p + 30, true);
        const commLen   = cv.getUint16(p + 32, true);
        let   localOff  = cv.getUint32(p + 42, true);

        const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
        const name = utf8.decode(nameBytes);

        // ZIP64 extra field (header id 0x0001)
        if (fullSize === 0xffffffff || compSize === 0xffffffff || localOff === 0xffffffff) {
          let e = p + 46 + nameLen;
          const eEnd = e + extraLen;
          while (e + 4 <= eEnd) {
            const id = cv.getUint16(e, true), len = cv.getUint16(e + 2, true);
            if (id === 0x0001) {
              let q = e + 4;
              if (fullSize === 0xffffffff) { fullSize = Number(cv.getBigUint64(q, true)); q += 8; }
              if (compSize === 0xffffffff) { compSize = Number(cv.getBigUint64(q, true)); q += 8; }
              if (localOff === 0xffffffff) { localOff = Number(cv.getBigUint64(q, true)); q += 8; }
              break;
            }
            e += 4 + len;
          }
        }

        p += 46 + nameLen + extraLen + commLen;

        const dir = name.endsWith('/');
        if (dir) continue;
        const base = name.slice(name.lastIndexOf('/') + 1);
        if (!base || base.startsWith('.') || base === '__MACOSX') continue;

        entries.push({
          name, base, dir, size: fullSize, compSize, method, localOff, flags,
          mtime: dosToDate(dosDate, dosTime),
        });
      }

      if (!entries.length) throw new Error(global.I18n.t('e.emptyzip'));
      this.entries = entries;
      return this;
    }

    /** Where the real data begins: the local header carries its own lengths. */
    async dataStart(entry) {
      if (entry._start != null) return entry._start;
      const head = await slice(this.file, entry.localOff, entry.localOff + 30);
      const hv = view(head);
      entry._start = entry.localOff + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      return entry._start;
    }

    async bytes(entry) {
      const start = await this.dataStart(entry);
      const raw = await slice(this.file, start, start + entry.compSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return inflateRaw(raw);
      throw new Error('Unsupported compression method (' + entry.method + ') for ' + entry.base);
    }

    /**
     * Photos, videos and audio in WhatsApp archives are stored uncompressed.
     * When that's the case there is no need to read them: just slice the
     * original file and let the browser pull from disk when it needs to.
     * Copying them into memory would cost megabytes and milliseconds per file.
     */
    async blob(entry, mime) {
      const start = await this.dataStart(entry);
      if (entry.method === 0) return this.file.slice(start, start + entry.size, mime || '');
      return new Blob([await this.bytes(entry)], { type: mime || '' });
    }

    /**
     * First n bytes of an entry. Photos and videos in WhatsApp .zip files are
     * stored uncompressed (they are already compressed formats), so the header
     * can be read directly, without touching the rest of the file.
     */
    async head(entry, n) {
      const start = await this.dataStart(entry);
      if (entry.method === 0) {
        return slice(this.file, start, start + Math.min(n, entry.size));
      }
      if (entry.compSize > 4 * 1024 * 1024) return null;   // too big to inflate
      return (await this.bytes(entry)).subarray(0, n);
    }

    async text(entry) {
      return decodeText(await this.bytes(entry));
    }
  }

  /* ------------------------------------------------------- FolderArchive */
  class FolderArchive {
    constructor(files) {
      this.files = Array.from(files);
      this.name = (this.files[0] && this.files[0].webkitRelativePath || '').split('/')[0] || 'folder';
      this.entries = this.files
        .filter(f => f.name && !f.name.startsWith('.') && !/(^|\/)__MACOSX\//.test(f.webkitRelativePath || ''))
        .map((f, i) => ({
          name: f.webkitRelativePath || f.name,
          base: f.name, dir: false, size: f.size, _file: f, mtime: new Date(f.lastModified),
        }));
    }
    async bytes(entry) { return new Uint8Array(await entry._file.arrayBuffer()); }
    async head(entry, n) {
      return new Uint8Array(await entry._file.slice(0, n).arrayBuffer());
    }
    async blob(entry, mime) {
      return mime && entry._file.type !== mime
        ? new Blob([entry._file], { type: mime })
        : entry._file;
    }
    async text(entry) { return decodeText(await this.bytes(entry)); }
  }

  /* --------------------------------------------------------------- utils */
  function dosToDate(d, t) {
    try {
      return new Date(1980 + ((d >> 9) & 0x7f), ((d >> 5) & 0x0f) - 1, d & 0x1f,
                      (t >> 11) & 0x1f, (t >> 5) & 0x3f, (t & 0x1f) * 2);
    } catch (_) { return null; }
  }

  /** Decode text, handling UTF-8 / UTF-16 BOMs. */
  function decodeText(u8) {
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(u8.subarray(2));
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(u8.subarray(2));
    }
    let s = utf8.decode(u8);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return s;
  }

  global.Archive = { ZipArchive, FolderArchive, decodeText, inflateRaw };
})(window);
