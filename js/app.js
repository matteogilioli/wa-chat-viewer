/* ==========================================================================
   app.js — wiring between archive, parser, virtual list and interface.
   ========================================================================== */
(function (global) {
  'use strict';

  const { Archive, Parser, Fmt, Media, Virtual, Renderer, Panels, Lightbox } = global;
  const { Panel, Search } = Panels;
  const t = (k, v) => global.I18n.t(k, v);
  const $ = (id) => document.getElementById(id);

  const LS_THEME = 'wa-viewer:theme';
  const LS_ME = 'wa-viewer:me:';

  /* Storage is not always reachable (sandboxed frames, blocked site data, some
     file:// setups). Losing the saved preferences is fine; crashing is not. */
  const store = {
    get(k) { try { return global.localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { global.localStorage.setItem(k, v); } catch (_) { /* not stored */ } },
  };

  const App = {
    archive: null, archiveName: '', store: null, list: null,
    messages: [], participants: [], me: null, isGroup: false,
    chatName: '', dateOrder: 'dmy', dateOrderPref: 'auto', rawText: '', fileMap: null,
    theme: store.get(LS_THEME) || 'auto',

    /* ----------------------------------------------------------- loading */

    async load(source) {
      showProgress(0, t('p.open'));
      $('loadError').hidden = true;
      try {
        let archive;
        if (source instanceof File && Archive.ZipArchive.isZip(source)) {
          archive = await new Archive.ZipArchive(source).open();
        } else if (source instanceof File) {
          archive = new Archive.FolderArchive([source]);
        } else {
          archive = new Archive.FolderArchive(source);
        }

        const chatEntry = pickChatFile(archive.entries);
        if (!chatEntry) {
          throw new Error(t('e.nochat'));
        }

        showProgress(0.25, t('p.read'));
        this.archive = archive;
        this.archiveName = archive.name;
        this.rawText = await archive.text(chatEntry);

        this.fileMap = new Map();
        for (const e of archive.entries) {
          if (e === chatEntry) continue;
          this.fileMap.set(e.base.toLowerCase(), e);
          this.fileMap.set(e.name.toLowerCase(), e);
        }

        await this.parseAndShow('auto');
      } catch (err) {
        console.error(err);
        $('loadProgress').hidden = true;
        $('loadError').hidden = false;
        $('loadError').textContent = err && err.message ? err.message : String(err);
      }
    },

    async parseAndShow(orderPref) {
      showProgress(0.35, t('p.parse'));
      const res = await Parser.parse(this.rawText, this.fileMap, {
        order: orderPref,
        onProgress: (p) => showProgress(0.35 + p * 0.55, t('p.parse')),
      });
      if (!res.messages.length) {
        throw new Error(t('e.empty'));
      }

      this.dateOrderPref = orderPref;
      this.dateOrder = res.order;
      this.messages = res.messages;
      this.participants = res.participants;
      this.isGroup = res.participants.length > 2;
      this.chatName = guessChatName(this.archiveName, res.participants, this.isGroup);
      this.me = this.pickMe();

      showProgress(0.95, t('p.prepare'));
      this.store = new Media.MediaStore(this.archive, 140);
      this.ratios = await scanImageSizes(this.archive, this.messages);
      Lightbox.setGallery(collectGallery(this.messages));
      this.mount();
      $('loadProgress').hidden = true;
    },

    /** Who you are: the saved choice, otherwise "not the person in the title". */
    pickMe() {
      const saved = store.get(LS_ME + this.chatName);
      if (saved && this.participants.some(p => p.name === saved)) return saved;
      // some exports sign your own messages with the localized word for "you"
      const you = this.participants.find(p => global.Markers.isYou(p.name));
      if (you) return you.name;
      if (this.participants.length === 2) {
        const other = this.participants.find(p => this.chatName.includes(p.name));
        if (other) {
          const me = this.participants.find(p => p.name !== other.name);
          if (me) return me.name;
        }
      }
      return null;
    },

    setMe(name) {
      this.me = name;
      store.set(LS_ME + this.chatName, name);
      this.updateHeader();
      this.redraw();
    },

    setTheme(v) {
      this.theme = v;
      store.set(LS_THEME, v);
      applyTheme(v);
    },

    async reparse(orderPref) {
      if (this.list) { this.list.destroy(); this.list = null; }
      if (this.store) this.store.dispose();
      Panel.close();
      $('app').hidden = true;
      $('welcome').hidden = false;
      await this.parseAndShow(orderPref);
    },

    /* -------------------------------------------------------------- view */

    mount() {
      $('welcome').hidden = true;
      $('app').hidden = false;
      this.updateHeader();

      Fmt.setMentions(this.participants.map(p => p.name));
      Renderer.init({
        ratios: this.ratios || new Map(),
        messages: this.messages,
        me: this.me,
        isGroup: this.isGroup,
        store: this.store,
        highlight: '',
        flashIndex: -1,
      });

      const chat = $('chat'), inner = $('list');
      inner.innerHTML = '';
      this.list = new Virtual.VirtualList({
        scroller: chat,
        inner,
        count: this.messages.length,
        estimate: Renderer.estimate,
        render: Renderer.row,
      });
      Renderer.state.list = this.list;
      this.list.scrollToBottom();
      requestAnimationFrame(() => this.list.scrollToBottom());

      chat.addEventListener('scroll', () => {
        const far = chat.scrollHeight - chat.scrollTop - chat.clientHeight > 600;
        $('btnDown').hidden = !far;
        this.updateDateChip();
      }, { passive: true });
      this.updateDateChip();
    },

    /** Date of the first visible message, shown at the top while scrolling. */
    updateDateChip() {
      const chip = $('dateChip');
      if (!this.list || !this.messages.length) { chip.classList.remove('on'); return; }
      const chat = $('chat');
      const i = this.list.fen.search(chat.scrollTop + 4);
      const msg = this.messages[Math.max(0, Math.min(this.messages.length - 1, i))];
      const label = Fmt.dayLabel(msg.t);
      if (label !== this._chipLabel) {
        chip.firstChild.textContent = label;
        this._chipLabel = label;
      }
      // at the top the real separator is already there: the chip would only repeat it
      chip.classList.toggle('on', chat.scrollTop > 30);
    },

    updateHeader() {
      $('chatName').textContent = this.chatName;
      const av = $('chatAvatar');
      av.textContent = Fmt.initials(this.chatName);
      av.style.background = Fmt.colorFor(this.chatName);
      // count matches the statistics: system notices are not messages
      const n = this.messages.reduce((k, m) => k + (m.sys ? 0 : 1), 0).toLocaleString(Fmt.LOCALE);
      $('chatSub').textContent = this.me
        ? (this.isGroup ? t('h.participants', { n: this.participants.length }) + ' · ' : '') +
          t('h.messages', { n })
        : t('h.whoareyou');
    },

    /** Redraws everything, keeping the reading position. */
    redraw() {
      if (!this.list) return;
      Renderer.state.me = this.me;
      Renderer.measureColumn();
      const anchor = this.list.fen.search(this.list.scroller.scrollTop);
      this.list.clear();
      this.list.resetHeights();
      this.list.update();
      this.list.scrollToIndex(anchor, 'start');
    },

    jumpTo(i, align) {
      Renderer.state.flashIndex = i;
      setTimeout(() => this.updateDateChip(), 60);
      this.list.invalidate(i);
      this.list.scrollToIndex(i, align || 'center');
      clearTimeout(this._flash);
      this._flash = setTimeout(() => {
        Renderer.state.flashIndex = -1;
        this.list && this.list.invalidate(i);
      }, 2000);
    },

    /** Re-renders everything that carries a translated label. */
    relabel() {
      if (!this.messages.length) return;
      this.updateHeader();
      if (Panel.isOpen) Panel.close();
      this.redraw();
    },

    reset() {
      if (this.list) { this.list.destroy(); this.list = null; }
      if (this.store) { this.store.dispose(); this.store = null; }
      Lightbox.close();
      this.messages = [];
      this.archive = null;
      $('app').hidden = true;
      $('welcome').hidden = false;
      $('loadProgress').hidden = true;
      $('searchbar').hidden = true;
      $('fileInput').value = '';
    },
  };

  /* ------------------------------------------------------------- helpers */

  function pickChatFile(entries) {
    const txt = entries.filter(e => /\.txt$/i.test(e.base));
    if (!txt.length) return null;
    return txt.find(e => /^_chat\.txt$/i.test(e.base))
        || txt.find(e => /chat/i.test(e.base))
        || txt.sort((a, b) => b.size - a.size)[0];
  }

  /** Works out the chat name from the name of the archive WhatsApp exported. */
  function guessChatName(archiveName, participants, isGroup) {
    let n = String(archiveName || '').replace(/\.zip$/i, '');
    n = n.replace(/^whatsapp\s*chat(\s*[-–—]\s*|\s+(con|with|mit|avec|com)\s+)/i, '')
         .replace(/^chat\s*(whatsapp)?\s*(con|with)?\s*[-–—]?\s*/i, '')
         .trim();
    if (n && n.toLowerCase() !== 'chat' && n.length < 80) return n;
    if (isGroup) return t('h.group');
    return participants.map(p => p.name).slice(0, 2).join(', ') || t('h.chat');
  }

  /**
   * Reads photo aspect ratios straight from the file headers, before the chat
   * is shown. It costs a few milliseconds (media inside WhatsApp archives is
   * not compressed) and lets us reserve the right amount of room up front:
   * without it a bubble has no height until its photo loads, and if you
   * scroll fast you see nothing but the background.
   */
  async function scanImageSizes(archive, messages) {
    const ratios = new Map();
    const seen = new Set();
    const entries = [];
    for (const m of messages) {
      if (!m.files) continue;
      for (const f of m.files) {
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        if (Media.kindOf(f.base) === 'image') entries.push(f);
      }
    }
    if (!entries.length) return ratios;

    const t0 = performance.now();
    let next = 0;
    const worker = async () => {
      while (next < entries.length && performance.now() - t0 < 2500) {
        const e = entries[next++];
        try {
          const head = await archive.head(e, 65536);
          const size = head && Media.imageSize(head);
          if (size && size.w > 0 && size.h > 0) ratios.set(e.name, size.w / size.h);
        } catch (_) { /* one unreadable photo must not stop the load */ }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return ratios;
  }

  function collectGallery(messages) {
    const out = [];
    for (const m of messages) {
      if (!m.files) continue;
      for (const f of m.files) {
        const k = Media.kindOf(f.base);
        if (k === 'image' || k === 'video') out.push(f);
      }
    }
    return out;
  }

  function showProgress(p, label) {
    const box = $('loadProgress');
    box.hidden = false;
    box.querySelector('.progress-bar i').style.width = Math.round(p * 100) + '%';
    box.querySelector('.progress-label').textContent = label;
  }

  function applyTheme(v) {
    const root = document.documentElement;
    if (v === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', v);
    const dark = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#202c33' : '#f0f2f5';
  }

  /* ------------------------------------------------------------------ UI */

  function wire() {
    global.I18n.init();
    applyTheme(App.theme);

    const ls = $('langSelect');
    for (const { code, name } of global.I18n.list) {
      const o = document.createElement('option');
      o.value = code; o.textContent = name;
      o.selected = code === global.I18n.lang;
      ls.appendChild(o);
    }
    ls.addEventListener('change', () => global.I18n.setLang(ls.value));

    const dz = $('dropzone');
    dz.addEventListener('click', () => $('fileInput').click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); }
    });
    $('pickFolder').addEventListener('click', () => $('folderInput').click());
    $('pickTxt').addEventListener('click', () => $('txtInput').click());

    $('fileInput').addEventListener('change', (e) => e.target.files[0] && App.load(e.target.files[0]));
    $('txtInput').addEventListener('change', (e) => e.target.files[0] && App.load(e.target.files[0]));
    $('folderInput').addEventListener('change', (e) => e.target.files.length && App.load(e.target.files));

    ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, (e) => {
      e.preventDefault();
      if ($('welcome').hidden) return;
      dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('over');
    }));
    document.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f && $('welcome').hidden === false) App.load(f);
    });

    $('btnHome').addEventListener('click', () => App.reset());
    $('btnDown').addEventListener('click', () => App.list.scrollToBottom());

    $('btnStats').addEventListener('click', () => Panel.open(t('pan.stats'), Panels.statsPanel(App)));
    $('btnSettings').addEventListener('click', () => Panel.open(t('pan.settings'), Panels.settingsPanel(App)));
    $('panelClose').addEventListener('click', () => Panel.close());
    $('scrim').addEventListener('click', () => Panel.close());

    /* --- search --- */
    const si = $('searchInput');
    $('btnSearch').addEventListener('click', () => {
      const bar = $('searchbar');
      bar.hidden = !bar.hidden;
      if (!bar.hidden) si.focus();
      else closeSearch();
    });
    $('searchClose').addEventListener('click', closeSearch);
    let deb;
    si.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => {
        Search.run(si.value, App);
        if (Search.hits.length) App.jumpTo(Search.hits[Search.pos]);
        if (si.value.trim().length >= 2 && !matchMedia('(max-width:640px)').matches) {
          Panel.open(t('pan.results'), Search.panel(App));
        }
      }, 220);
    });
    si.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); Search.step(e.shiftKey ? -1 : 1, App); }
    });
    $('searchPrev').addEventListener('click', () => Search.step(-1, App));
    $('searchNext').addEventListener('click', () => Search.step(1, App));

    function closeSearch() {
      $('searchbar').hidden = true;
      si.value = '';
      Search.hits = [];
      Search.term = '';
      Renderer.state.highlight = '';
      $('searchCount').textContent = '';
      if (Panel.isOpen && $('panelTitle').textContent === t('pan.results')) Panel.close();
      App.redraw();
    }

    /* --- shared tooltip for the "not attached" placeholders --- */
    const tip = $('tip');
    let tipFor = null;
    // Touching the DOM on every scroll event would invalidate styles each
    // frame: only act when the tooltip is actually up.
    const hideTip = () => {
      if (!tipFor) return;
      tip.classList.remove('on');
      tip.hidden = true;
      tipFor = null;
    };
    const showTip = (el) => {
      tip.textContent = el.dataset.why || '';
      tip.hidden = false;
      tip.style.left = '0px';
      tip.style.top = '0px';
      const r = el.getBoundingClientRect();
      const box = $('app').getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.max(8, Math.min(r.left - box.left, box.width - w - 8));
      tip.style.left = left + 'px';
      tip.style.top = (r.top - box.top - h - 9) + 'px';
      // the arrow follows the element, even when the box had to be nudged
      tip.style.setProperty('--tip-arrow',
        Math.max(10, Math.min(w - 16, r.left - box.left - left + 12)) + 'px');
      tip.classList.add('on');
      tipFor = el;
    };
    const chatEl = $('chat');
    chatEl.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('.missing.has-why');
      if (el && el !== tipFor) showTip(el);
    });
    chatEl.addEventListener('mouseout', (e) => {
      if (e.target.closest && e.target.closest('.missing.has-why')) hideTip();
    });
    chatEl.addEventListener('scroll', hideTip, { passive: true });

    /* --- lightbox --- */
    $('lbClose').addEventListener('click', () => Lightbox.close());
    $('lbPrev').addEventListener('click', () => Lightbox.step(-1));
    $('lbNext').addEventListener('click', () => Lightbox.step(1));
    $('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.id === 'lbStage') Lightbox.close(); });

    document.addEventListener('keydown', (e) => {
      if (Lightbox.isOpen) {
        if (e.key === 'Escape') Lightbox.close();
        if (e.key === 'ArrowLeft') Lightbox.step(-1);
        if (e.key === 'ArrowRight') Lightbox.step(1);
        return;
      }
      if (e.key === 'Escape') {
        if (Panel.isOpen) Panel.close();
        else if (!$('searchbar').hidden) closeSearch();
        return;
      }
      if (e.key === '/' && document.activeElement === document.body && !$('app').hidden) {
        e.preventDefault();
        $('searchbar').hidden = false;
        si.focus();
      }
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(App.theme));
  }

  global.App = App;
  /* Only wire up when there is a page to wire: the file is also loaded bare in
     the module smoke test, where no document exists. */
  if (global.document) global.document.addEventListener('DOMContentLoaded', wire);
})(window);
