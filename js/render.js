/* ==========================================================================
   render.js — building the bubbles.
   Every row of the virtual list is a self-contained element: day separator
   (when the message opens a new date) + the message bubble.
   ========================================================================== */
(function (global) {
  'use strict';

  const { Fmt, Media } = global;
  const t = (k, v) => global.I18n.t(k, v);

  const ICON = {
    checks: '<svg viewBox="0 0 24 24"><path d="M1 13l4 4L14 8"/><path d="M8 13l4 4 9-9"/></svg>',
    play:   '<svg viewBox="0 0 12 14"><path d="M0 0v14l12-7z"/></svg>',
    pause:  '<svg viewBox="0 0 12 14"><path d="M0.5 0h4v14h-4zM7.5 0h4v14h-4z"/></svg>',
    mic:    '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    doc:    '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    dl:     '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>',
    lock:   '<svg viewBox="0 0 24 24" class="lock"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    ban:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    image:  '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-4 4-2-2-7 7"/></svg>',
    video:  '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3z"/></svg>',
    audio:  '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    sticker:'<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 8 8c0-4.4 3.6-8 8-8"/></svg>',
    phone:  '<svg viewBox="0 0 24 24"><path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 5.2 2 2 0 0 1 6 3z"/></svg>',
    pin:    '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    poll:   '<svg viewBox="0 0 24 24"><path d="M5 20V9m7 11V4m7 16v-7"/></svg>',
    once:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M11 8.5 12.5 8v8M10.5 16h4"/></svg>',
  };

  // Icons are parsed once and then cloned: re-parsing the SVG on every row is
  // one of the biggest costs when scrolling fast.
  const iconCache = new Map();
  function icon(name) {
    let tpl = iconCache.get(name);
    if (!tpl) {
      tpl = document.createElement('template');
      tpl.innerHTML = ICON[name];
      iconCache.set(name, tpl);
    }
    return tpl.content.firstChild.cloneNode(true);
  }

  /**
   * Marks a single row as possibly having changed height (a media file just
   * arrived). Only that row is marked: flagging every visible row would force
   * the browser to re-measure them all on the next frame, and on Safari every
   * height read costs a layout recalculation.
   */
  function heightChanged(el) {
    if (!st.list) return;
    const row = el.closest && el.closest('.row');
    const i = row && row.dataset.i != null ? +row.dataset.i : -1;
    if (i >= 0) st.list.measured[i] = 0;
    st.list.schedule();
  }

  const WAVE_BARS = 34;
  const GROUP_GAP = 5 * 60 * 1000;   // same sender within 5 minutes = one group

  const st = {
    messages: [], me: null, isGroup: false, store: null, list: null,
    highlight: '', flashIndex: -1, colWidth: 0,
  };

  function init(o) {
    Object.assign(st, o);
    st.ratios = st.ratios || new Map();
    measureColumn();
    calibrate();
    buildAlbums();
  }

  /**
   * Measures up front how tall a line of text is and how much the padding,
   * the timestamp and the sender name add. Hard-coded guesses are off by a few
   * pixels per message, and when the real measurement lands the list jumps
   * under you mid-scroll.
   */
  function calibrate() {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const bench = document.createElement('div');
    bench.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:0;right:0';
    chat.appendChild(bench);

    const sample = (lines, first, author) => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = '<div class="msg in' + (first ? ' first' : '') + '"><div class="bubble">' +
        (author ? '<div class="author">Name</div>' : '') +
        '<div class="text">' + Array.from({ length: lines }, () => 'text').join('<br>') + '</div>' +
        '<div class="meta"><span>00:00</span></div></div></div>';
      bench.appendChild(r);
      const h = r.offsetHeight;
      r.remove();
      return h;
    };

    const h1 = sample(1, false, false);
    const h2 = sample(2, false, false);
    st.metrics = {
      line: Math.max(12, h2 - h1),
      chrome: h1 - (h2 - h1),
      first: sample(1, true, false) - h1,
      author: sample(1, false, true) - h1,
      daysep: 46,
    };
    bench.remove();
  }

  const ALBUM_GAP = 90 * 1000;   // photos sent together: a few seconds apart

  /**
   * WhatsApp shows photos and videos sent together in a single tile. In the
   * export, though, every media file is a message of its own, so here they get
   * put back together: same sender, one after the other, a few seconds apart
   * and with no caption (except the last one, which in WhatsApp carries the
   * caption under the tile).
   */
  function buildAlbums() {
    st.albumFirst = new Map();   // first index -> every index in the album
    st.albumOf = new Map();      // any index -> the album's first index
    const isCell = (m) => m && m.files && m.files.length === 1 &&
      ['image', 'video'].includes(Media.kindOf(m.files[0].base));

    for (let i = 0; i < st.messages.length; i++) {
      if (!isCell(st.messages[i]) || st.messages[i].body) continue;
      const group = [i];
      let j = i + 1;
      while (j < st.messages.length) {
        const a = st.messages[j - 1], b = st.messages[j];
        if (!isCell(b) || b.sender !== a.sender || b.t - a.t > ALBUM_GAP) break;
        group.push(j);
        if (b.body) { j++; break; }        // the caption closes the album
        j++;
      }
      if (group.length >= 2) {
        st.albumFirst.set(i, group);
        for (const k of group) st.albumOf.set(k, i);
        i = group[group.length - 1];
      }
    }
  }

  /** Width of photos and videos in the bubbles: must match the CSS. */
  const photoWidth = () => Math.min(330, global.innerWidth * 0.7);

  /** Usable width of a bubble: only needed to estimate the height of the text. */
  function measureColumn() {
    const w = (document.getElementById('chat') || { clientWidth: 700 }).clientWidth || 700;
    const pad = w <= 640 ? 24 : w * (w >= 1100 ? 0.24 : 0.10);
    st.colWidth = Math.min(560, (w - pad) * 0.78);
  }

  const isFirstOfGroup = (i) => {
    const m = st.messages[i], p = st.messages[i - 1];
    if (!p || m.sys || p.sys) return true;
    if (p.sender !== m.sender) return true;
    return m.t - p.t > GROUP_GAP;
  };

  const opensDay = (i) => i === 0 || Fmt.dayKey(st.messages[i].t) !== Fmt.dayKey(st.messages[i - 1].t);

  const isOut = (m) => !m.sys && m.sender === st.me;

  /* ----------------------------------------------------------- heights */

  function estimate(i) {
    const m = st.messages[i];
    // media that sits inside an album has no row of its own
    if (st.albumOf.has(i) && st.albumOf.get(i) !== i) return 0;

    const M = st.metrics || { line: 19.3, chrome: 34, first: 9, author: 17, daysep: 46 };
    let h = opensDay(i) ? M.daysep : 0;
    if (m.sys) return h + 40;

    const cpl = Math.max(18, st.colWidth / 7.4);
    const textH = (s) => {
      if (!s) return 0;
      let rows = 0;
      for (const line of s.split('\n')) rows += Math.max(1, Math.ceil(line.length / cpl));
      return rows * M.line;
    };

    h += M.chrome;
    if (isFirstOfGroup(i)) h += M.first;
    if (!isOut(m) && st.isGroup && isFirstOfGroup(i)) h += M.author;

    if (st.albumFirst.has(i)) {
      const g = st.albumFirst.get(i);
      const w = Math.min(300, st.colWidth);
      return h + (g.length === 2 ? w * 0.5 : g.length === 3 ? w * 0.67 : w) +
             textH(st.messages[g[g.length - 1]].body);
    }

    if (m.files) {
      for (const f of m.files) h += mediaH(f);
      return h + textH(m.body);
    }
    if (m.poll) return h + 58 + m.poll.options.length * 38 + textH(m.poll.question);
    if (m.omitted || m.deleted || m.call || m.loc) return h + (m.loc ? 46 : 24);
    if (Fmt.isEmojiOnly(m.body)) return h + 44;
    return h + (textH(m.body) || M.line);
  }

  /**
   * Height of an attachment. For photos and videos the aspect ratio is only
   * known once the file has been decoded; from then on it stays in memory, so
   * when you scroll back over the same messages the estimate is exact and the
   * list does not shift.
   */
  function mediaH(entry) {
    const kind = Media.kindOf(entry.base);
    if (kind === 'audio') return 52;
    if (kind === 'sticker') return 148;
    if (kind === 'vcard' || kind === 'doc') return 56;
    const width = photoWidth();
    const ratio = st.ratios.get(entry.name) || 4 / 3;
    return Math.min(width / ratio, Math.min(innerHeight * 0.62, 460));
  }

  /* --------------------------------------------------------------- row */

  function row(i) {
    const m = st.messages[i];
    const el = document.createElement('div');
    el.className = 'row' + (i === st.flashIndex ? ' flash' : '');

    // media absorbed by an album: the row exists but takes up no space
    if (st.albumOf.has(i) && st.albumOf.get(i) !== i) return el;

    if (opensDay(i)) {
      const d = document.createElement('div');
      d.className = 'daysep';
      d.innerHTML = '<span></span>';
      d.firstChild.textContent = Fmt.dayLabel(m.t);
      el.appendChild(d);
    }

    if (m.sys) {
      const w = document.createElement('div');
      w.className = 'msg sys';
      const b = document.createElement('div');
      // in WhatsApp yellow is reserved for the encryption notice: group
      // events (people added, name, description) are neutral
      b.className = 'sysbubble' + (m.security ? ' security' : '');
      b.innerHTML = (m.security ? ICON.lock : '') + Fmt.escapeHtml(m.body);
      w.appendChild(b);
      el.appendChild(w);
      return el;
    }

    const out = isOut(m);
    const first = isFirstOfGroup(i);
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (out ? 'out' : 'in') + (first ? ' first' : '');

    const bub = document.createElement('div');
    bub.className = 'bubble';

    if (!out && st.isGroup && first) {
      const a = document.createElement('div');
      a.className = 'author';
      a.style.color = Fmt.colorFor(m.sender);
      a.textContent = m.sender;
      bub.appendChild(a);
    }

    let onlySticker = false;
    if (st.albumFirst.has(i)) {
      bub.appendChild(albumNode(st.albumFirst.get(i)));
      bub.classList.add('with-media');
      const last = st.messages[st.albumFirst.get(i).slice(-1)[0]];
      if (last.body) {
        const cap = document.createElement('div');
        cap.className = 'text';
        cap.innerHTML = Fmt.richText(last.body, st.highlight);
        bub.appendChild(cap);
      }
    } else if (m.files) {
      for (const f of m.files) {
        const kind = Media.kindOf(f.base);
        bub.appendChild(mediaNode(m, f, kind, i));
        if (kind === 'sticker' && m.files.length === 1 && !m.body) onlySticker = true;
        // photos and videos fill the bubble, so it needs tighter padding
        if (kind === 'image' || kind === 'video') bub.classList.add('with-media');
      }
    } else if (m.deleted) {
      bub.appendChild(pill(ICON.ban, m.body || t('m.deleted')));
    } else if (m.omitted) {
      // when we know the file name we show that; otherwise WhatsApp's own
      // localized text («immagine omessa», «video omitted», …) says it all
      const kind = m.missingName ? Media.kindOf(m.missingName) : m.omittedKind;
      const label = m.missingName
        ? t('m.notInArchive', { name: Media.prettyName(m.missingName) })
        : m.body;
      const icon = m.viewOnce ? ICON.once
        : ICON[kind === 'image' ? 'image' : kind === 'video' ? 'video'
             : kind === 'audio' ? 'audio' : kind === 'sticker' ? 'sticker' : 'doc'];
      // the .txt file NEVER says which of the three cases applies: better to
      // spell them all out in a hint than to pick one at random
      bub.appendChild(pill(icon, label, m.viewOnce ? null : t('m.whyOmitted')));
    } else if (m.call) {
      bub.appendChild(pill(ICON.phone, m.body));
    } else if (m.loc) {
      bub.appendChild(locationNode(m));
    } else if (m.poll) {
      bub.appendChild(pollNode(m));
    }

    if (m.body && !m.deleted && !m.omitted && !m.call && !m.loc && !m.poll) {
      const t = document.createElement('div');
      t.className = 'text';
      if (Fmt.isEmojiOnly(m.body) && !m.files) {
        bub.classList.add('emoji-only');
        t.innerHTML = '<span class="big-emoji">' + Fmt.escapeHtml(m.body) + '</span>';
      } else {
        t.innerHTML = Fmt.richText(m.body, st.highlight);
      }
      bub.appendChild(t);
    }
    if (onlySticker) bub.classList.add('sticker-only');

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (m.edited) {
      const e = document.createElement('span');
      e.className = 'edited';
      e.textContent = t('m.edited') + ' ';
      meta.appendChild(e);
    }
    const time = document.createElement('span');
    time.textContent = Fmt.time(m.t);
    meta.appendChild(time);
    if (out) meta.appendChild(icon('checks'));
    meta.title = Fmt.fullDate(m.t);
    // in voice notes the time sits next to the duration, not on a line of its own
    (bub.querySelector('.a-foot') || bub).appendChild(meta);

    wrap.appendChild(bub);
    el.appendChild(wrap);
    return el;
  }

  /**
   * Placeholder with an icon. When there is an explanation it can be opened
   * with a tap: the browser's native tooltip needs a second of hovering with
   * the mouse and on a touch screen it never shows up at all.
   */
  function pill(icon, text, hint) {
    const d = document.createElement('div');
    d.className = 'missing' + (hint ? ' has-why' : '');
    d.innerHTML = icon + '<span></span>';
    d.lastChild.textContent = text;
    if (hint) {
      d.dataset.why = hint;                    // the box itself is drawn in CSS
      // where there is no mouse (phones and tablets) a tap opens the explanation
      if (!global.matchMedia('(hover: hover)').matches) d.addEventListener('click', () => {
        const next = d.nextElementSibling;
        if (next && next.classList.contains('why')) next.remove();
        else {
          const w = document.createElement('div');
          w.className = 'why';
          w.textContent = hint;
          d.after(w);
        }
        heightChanged(d);
      });
    }
    return d;
  }

  /** Tile for photos and videos sent together, grouped the way WhatsApp does. */
  function albumNode(indexes) {
    const box = document.createElement('div');
    const n = indexes.length;
    const shown = Math.min(n, 4);
    box.className = 'album n' + (n === 2 ? 2 : n === 3 ? 3 : 4);

    for (let k = 0; k < shown; k++) {
      const msg = st.messages[indexes[k]];
      const entry = msg.files[0];
      const cell = document.createElement('div');
      cell.className = 'al-cell';
      cell.dataset.srcKey = entry.name;

      const img = document.createElement('img');
      img.decoding = 'async';
      img.alt = Media.prettyName(entry.base);
      cell.appendChild(img);
      st.store.url(entry).then(u => { img.src = u; }).catch(() => {});
      img.addEventListener('load', () => heightChanged(cell));

      if (Media.kindOf(entry.base) === 'video') {
        const play = document.createElement('div');
        play.className = 'playbadge';
        play.innerHTML = '<i>' + ICON.play + '</i>';
        cell.appendChild(play);
      }
      if (k === shown - 1 && n > shown) {
        const more = document.createElement('div');
        more.className = 'al-more';
        more.textContent = '+' + (n - shown);
        cell.appendChild(more);
      }
      cell.addEventListener('click', () => global.Lightbox && global.Lightbox.open(entry));
      box.appendChild(cell);
    }
    return box;
  }

  /** Poll card: question, options with bars and the vote total. */
  function pollNode(m) {
    const box = document.createElement('div');
    box.className = 'poll';
    const opts = m.poll.options;
    const total = opts.reduce((s, o) => s + o.votes, 0);
    const max = Math.max(1, ...opts.map(o => o.votes));

    const head = document.createElement('div');
    head.className = 'p-head';
    head.innerHTML = ICON.poll + '<span></span>';
    head.lastChild.textContent = t('m.poll');
    const q = document.createElement('div');
    q.className = 'p-q';
    q.textContent = m.poll.question;
    box.append(head, q);

    for (const o of opts) {
      const row = document.createElement('div');
      row.className = 'p-opt';
      row.innerHTML = '<div class="p-line"><span class="p-txt"></span><span class="p-n"></span></div>' +
                      '<div class="p-bar"><i></i></div>';
      row.querySelector('.p-txt').textContent = o.text;
      row.querySelector('.p-n').textContent = o.votes;
      row.querySelector('.p-bar i').style.width = (o.votes * 100 / max) + '%';
      box.appendChild(row);
    }
    const foot = document.createElement('div');
    foot.className = 'p-tot';
    foot.textContent = t('m.votes', { n: total });
    box.appendChild(foot);
    return box;
  }

  function locationNode(m) {
    const a = document.createElement('a');
    a.className = 'doc';
    a.href = m.loc.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = '<span class="d-ico">' + ICON.pin + '</span><span><span class="d-name">Posizione condivisa</span>' +
                  '<span class="d-sub">' + m.loc.lat + ', ' + m.loc.lng + '</span></span>';
    return a;
  }

  /* ------------------------------------------------------------- media */

  function mediaNode(m, entry, kind, i) {
    if (kind === 'audio') return audioNode(m, entry);
    if (kind === 'doc' || kind === 'vcard') return docNode(m, entry, kind);

    const box = document.createElement('div');
    const ratio = st.ratios.get(entry.name);
    box.className = 'media' +
                    (kind === 'sticker' ? ' sticker' : kind === 'image' ? ' photo' : kind === 'video' ? ' vid' : '') +
                    (m.body ? ' with-caption' : '');
    box.dataset.srcKey = entry.name;
    // reserve the space before the file has even loaded
    if (kind === 'image' || kind === 'video') box.style.aspectRatio = String(ratio || 4 / 3);

    if (kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.playsInline = true;
      v.muted = true;
      box.appendChild(v);
      st.store.url(entry).then(u => { v.src = u; }).catch(() => box.appendChild(errNode(entry)));

      // WhatsApp shows the first frame with a play button on top and only opens
      // the player on tap. A bare <video> would sit there as a black rectangle
      // until the user pressed play.
      const badge = document.createElement('div');
      badge.className = 'playbadge';
      badge.innerHTML = '<i></i>';
      badge.firstChild.appendChild(icon('play'));
      const len = document.createElement('div');
      len.className = 'vidlen';
      box.append(badge, len);
      box.addEventListener('click', () => global.Lightbox && global.Lightbox.open(entry));

      // WhatsApp exports GIFs and animated stickers as .mp4 and plays them
      // itself, looping and muted: a short video has to be treated the same
      // way, otherwise it just sits there behind a play button like a movie.
      v.addEventListener('loadedmetadata', () => {
        if (v.videoWidth && v.videoHeight) {
          st.ratios.set(entry.name, v.videoWidth / v.videoHeight);
          box.style.aspectRatio = String(v.videoWidth / v.videoHeight);
        }
        const animated = /gif|sticker/i.test(entry.base) ||
                         (isFinite(v.duration) && v.duration > 0 && v.duration <= 6);
        if (animated) {
          v.loop = true;
          v.autoplay = true;
          box.classList.add('looping');
          badge.remove();
          if (/gif/i.test(entry.base)) len.textContent = 'GIF';
          v.play().catch(() => box.appendChild(badge));
        } else {
          len.textContent = Fmt.duration(v.duration);
          // Nudging the playhead makes the element paint that frame: cheapest
          // way to get a thumbnail, with no canvas and no second decode.
          try { v.currentTime = Math.min(0.1, (v.duration || 1) / 20); } catch (_) { /* ignore */ }
        }
        heightChanged(box);
      });
      return box;
    }

    const img = document.createElement('img');
    img.decoding = 'async';
    img.alt = Media.prettyName(entry.base);
    box.appendChild(img);
    st.store.url(entry).then(u => { img.src = u; }).catch(() => { box.innerHTML = ''; box.appendChild(errNode(entry)); });
    img.addEventListener('load', () => {
      if (img.naturalWidth) st.ratios.set(entry.name, img.naturalWidth / img.naturalHeight);
      heightChanged(box);
    });
    img.addEventListener('error', () => {
      box.innerHTML = '';
      box.appendChild(errNode(entry, t('m.badImage')));
      heightChanged(box);
    });
    if (kind !== 'sticker') {
      img.addEventListener('click', () => global.Lightbox && global.Lightbox.open(entry));
    }
    return box;
  }

  function errNode(entry, msg) {
    const d = document.createElement('div');
    d.className = 'ph';
    d.innerHTML = '<span></span>';
    d.firstChild.textContent = msg || t('m.cantRead');
    d.style.cursor = 'pointer';
    d.addEventListener('click', () => st.store.download(entry));
    return d;
  }

  function docNode(m, entry, kind) {
    const a = document.createElement('a');
    a.className = 'doc';
    a.href = '#';
    const name = m.docName || Media.prettyName(entry.base);
    const sub = kind === 'vcard' ? t('m.contact')
              : (m.docMeta || (Media.extOf(entry.base) + (entry.size ? ' · ' + Fmt.bytes(entry.size) : '')));
    a.innerHTML = '<span class="d-ico">' + (kind === 'vcard' ? ICON.person : ICON.doc) + '</span>' +
                  '<span style="min-width:0"><span class="d-name"></span><span class="d-sub"></span></span>' +
                  '<span class="d-dl">' + ICON.dl + '</span>';
    a.querySelector('.d-name').textContent = name;
    a.querySelector('.d-sub').textContent = sub;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (Media.extOf(entry.base) === 'pdf') {
        st.store.url(entry).then(u => global.open(u, '_blank'));
      } else {
        st.store.download(entry);
      }
    });
    if (kind === 'vcard') {
      st.store.url(entry).then(u => fetch(u)).then(r => r.text()).then(txt => {
        const fn = /(?:^|\n)FN[^:]*:(.+)/i.exec(txt);
        const tel = /(?:^|\n)TEL[^:]*:(.+)/i.exec(txt);
        if (fn) a.querySelector('.d-name').textContent = fn[1].trim();
        if (tel) a.querySelector('.d-sub').textContent = tel[1].trim();
      }).catch(() => {});
    }
    return a;
  }

  /* ------------------------------------------------------------- audio */

  function audioNode(m, entry) {
    const wrap = document.createElement('div');
    wrap.className = 'audio';
    wrap.dataset.srcKey = entry.name;
    const voice = Media.isVoiceNote(entry.base);
    const who = m.sender || '?';

    const av = document.createElement('div');
    av.className = 'a-avatar';
    av.style.background = Fmt.colorFor(who);
    av.textContent = Fmt.initials(who);
    if (voice) {
      const mic = document.createElement('span');
      mic.className = 'mic';
      mic.innerHTML = ICON.mic;
      av.appendChild(mic);
    }

    const btn = document.createElement('button');
    btn.className = 'a-play';
    btn.type = 'button';
    btn.innerHTML = ICON.play;
    btn.setAttribute('aria-label', 'Riproduci');

    const mid = document.createElement('div');
    mid.className = 'a-mid';
    const wave = document.createElement('div');
    wave.className = 'wave';
    const bars = Media.waveform(entry.base, WAVE_BARS);
    wave.innerHTML = bars.map(v => '<i style="height:' + (v * 100).toFixed(0) + '%"></i>').join('');
    const foot = document.createElement('div');
    foot.className = 'a-foot';
    const tl = document.createElement('span');
    tl.textContent = '--:--';
    const rate = document.createElement('button');
    rate.type = 'button';
    rate.className = 'a-rate';
    rate.textContent = Media.AudioBus.rate + '×';
    foot.append(tl, rate);
    if (!voice) {
      const nm = document.createElement('span');
      nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
      nm.textContent = Media.prettyName(entry.base);
      foot.appendChild(nm);
    }
    mid.append(wave, foot);
    wrap.append(av, btn, mid);

    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let loaded = false;
    const load = () => {
      if (loaded) return Promise.resolve();
      loaded = true;
      return st.store.url(entry).then(u => { audio.src = u; });
    };
    load();

    audio.addEventListener('loadedmetadata', () => { tl.textContent = Fmt.duration(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      const p = audio.currentTime / (audio.duration || 1);
      tl.textContent = Fmt.duration(audio.currentTime);
      const n = Math.round(p * WAVE_BARS);
      wave.childNodes.forEach((b, k) => b.classList.toggle('on', k < n));
    });
    audio.addEventListener('ended', () => {
      btn.innerHTML = ICON.play;
      wave.childNodes.forEach(b => b.classList.remove('on'));
      tl.textContent = Fmt.duration(audio.duration);
    });
    audio.addEventListener('pause', () => { btn.innerHTML = ICON.play; });
    audio.addEventListener('play', () => { btn.innerHTML = ICON.pause; });
    audio.addEventListener('error', () => {
      mid.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'a-err';
      e.textContent = t('m.audioFail');
      e.style.cursor = 'pointer';
      e.addEventListener('click', () => st.store.download(entry));
      mid.appendChild(e);
      heightChanged(wrap);
    });

    btn.addEventListener('click', () => {
      if (audio.paused) load().then(() => Media.AudioBus.play(audio).catch(() => {}));
      else audio.pause();
    });
    wave.addEventListener('click', (e) => {
      const r = wave.getBoundingClientRect();
      if (audio.duration) audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });
    rate.addEventListener('click', () => {
      const next = { 1: 1.5, 1.5: 2, 2: 1 }[Media.AudioBus.rate] || 1;
      Media.AudioBus.setRate(next);
      document.querySelectorAll('.a-rate').forEach(b => { b.textContent = next + '×'; });
    });

    wrap.appendChild(audio);
    return wrap;
  }

  global.Renderer = { init, row, estimate, measureColumn, state: st, ICON };
})(window);
