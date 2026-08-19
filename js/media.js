/* ==========================================================================
   media.js — file-type detection, on-demand extraction of media from the
   archive, and a cache of the temporary URLs.

   The archive is never loaded whole: a media file is extracted only when its
   bubble scrolls into view, and its URL is revoked once it drops out of the
   LRU cache. That keeps even a 2 GB archive manageable.
   ========================================================================== */
(function (global) {
  'use strict';

  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
    tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif', svg: 'image/svg+xml',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp',
    '3gpp': 'video/3gpp', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
    opus: 'audio/ogg; codecs=opus', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg',
    m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', amr: 'audio/amr',
    caf: 'audio/x-caf', flac: 'audio/flac',
    pdf: 'application/pdf', vcf: 'text/vcard', txt: 'text/plain', csv: 'text/csv',
    zip: 'application/zip', json: 'application/json', xml: 'application/xml',
  };

  const IMAGE = /^(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|svg)$/i;
  const VIDEO = /^(mp4|m4v|mov|3gpp?|mkv|webm|avi)$/i;
  const AUDIO = /^(opus|ogg|oga|mp3|m4a|aac|wav|amr|caf|flac)$/i;

  const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
  const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';

  /** Display name: iOS prefixes the file name with a counter like 00000042-. */
  const prettyName = (name) => name.replace(/^\d{6,}-/, '');

  function kindOf(name) {
    const e = extOf(name);
    if (e === 'vcf') return 'vcard';
    if (e === 'webp' || /sticker/i.test(name)) return 'sticker';
    if (IMAGE.test(e)) return 'image';
    if (VIDEO.test(e)) return 'video';
    if (AUDIO.test(e)) return 'audio';
    return 'doc';
  }

  /** Voice note recorded in the chat (as opposed to a forwarded audio file). */
  const isVoiceNote = (name) => /(^|[-_])(ptt|audio)[-_]/i.test(prettyName(name)) || extOf(name) === 'opus';

  /* -------------------------------------------------- image dimensions */

  /**
   * Width and height read straight from the file header, without decoding the
   * image. That lets us reserve the right amount of space in the bubble
   * before the photo is even loaded: otherwise the image is zero pixels tall,
   * the bubble collapses, and scrolling shows nothing but background until
   * the file arrives.
   */
  function imageSize(b) {
    if (!b || b.length < 24) return null;
    const be16 = (i) => (b[i] << 8) | b[i + 1];
    const be32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const le16 = (i) => b[i] | (b[i + 1] << 8);

    // PNG: the size sits in the first chunk, IHDR
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { w: be32(16), h: be32(20) };
    }
    // GIF
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { w: le16(6), h: le16(8) };
    }
    // WebP (RIFF)
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
      const type = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (type === 'VP8X') return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
                                    h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
      if (type === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
      if (type === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    // JPEG: walk the segments until we reach the one that declares the frame
    if (b[0] === 0xff && b[1] === 0xd8) {
      let p = 2;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        const m = b[p + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
        const len = be16(p + 2);
        const isSOF = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
        if (isSOF) return { h: be16(p + 5), w: be16(p + 7) };
        if (m === 0xda) break;                 // start of the compressed data
        p += 2 + len;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- store */

  class MediaStore {
    constructor(archive, limit) {
      this.archive = archive;
      this.limit = limit || 120;
      this.cache = new Map();     // entry.name -> { url, entry, hits }
      this.pending = new Map();
    }

    /** Temporary URL for a file in the archive (extracted on first use). */
    url(entry) {
      const hit = this.cache.get(entry.name);
      if (hit) {
        this.cache.delete(entry.name);       // refresh the LRU position
        this.cache.set(entry.name, hit);
        return Promise.resolve(hit.url);
      }
      if (this.pending.has(entry.name)) return this.pending.get(entry.name);

      const p = this.archive.blob(entry, mimeOf(entry.base))
        .then(blob => {
          const url = URL.createObjectURL(blob);
          this.cache.set(entry.name, { url, entry });
          this.pending.delete(entry.name);
          this.evict();
          return url;
        })
        .catch(err => {
          this.pending.delete(entry.name);
          throw err;
        });
      this.pending.set(entry.name, p);
      return p;
    }

    /** Drops the oldest cached media that are no longer on screen. */
    evict() {
      while (this.cache.size > this.limit) {
        const [key, val] = this.cache.entries().next().value;
        this.cache.delete(key);
        if (!document.querySelector('[data-src-key="' + attrEscape(key) + '"]')) {
          URL.revokeObjectURL(val.url);
        }
      }
    }

    /** Hands the browser a live blob when a document is downloaded. */
    async download(entry) {
      const url = await this.url(entry);
      const a = document.createElement('a');
      a.href = url;
      a.download = prettyName(entry.base);
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    dispose() {
      for (const { url } of this.cache.values()) URL.revokeObjectURL(url);
      this.cache.clear();
      this.pending.clear();
    }
  }

  // Inside a quoted attribute selector only quotes and backslashes need
  // escaping: CSS.escape is meant for identifiers, not for this.
  const attrEscape = (s) => s.replace(/["\\]/g, '\\$&');

  /* --------------------------------------------------------- audio bus */

  /** Makes sure only one track plays at a time, and remembers the speed. */
  const AudioBus = {
    current: null,
    rate: 1,
    play(el) {
      if (this.current && this.current !== el) this.current.pause();
      this.current = el;
      el.playbackRate = this.rate;
      return el.play();
    },
    setRate(r) {
      this.rate = r;
      if (this.current) this.current.playbackRate = r;
    },
  };

  /**
   * Pseudo-random but stable bars for the waveform: WhatsApp computes it while
   * recording and the export does not carry it, so we derive it from the file
   * name instead (same voice note = same waveform, always).
   */
  function waveform(seedStr, n) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) h = (h * 1103515245 + seedStr.charCodeAt(i) + 12345) | 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      h = (h * 1103515245 + 12345) | 0;
      const v = ((h >>> 16) & 0x7fff) / 0x7fff;
      out.push(0.22 + v * 0.78);
    }
    return out;
  }

  global.Media = { MIME, mimeOf, extOf, kindOf, prettyName, isVoiceNote, MediaStore, AudioBus,
                   waveform, imageSize };
})(window);
