/* ==========================================================================
   panels.js — search, statistics, settings and the full-screen viewer.
   ========================================================================== */
(function (global) {
  'use strict';

  const { Fmt, Media } = global;
  const t = (k, v) => global.I18n.t(k, v);
  const $ = (id) => document.getElementById(id);

  /* ======================================================= generic panel */

  const Panel = {
    open(title, node) {
      $('panelTitle').textContent = title;
      const body = $('panelBody');
      body.innerHTML = '';
      body.appendChild(node);
      body.scrollTop = 0;
      $('panel').hidden = false;
      $('scrim').hidden = false;
    },
    close() {
      $('panel').hidden = true;
      $('scrim').hidden = true;
    },
    get isOpen() { return !$('panel').hidden; },
  };

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ============================================================== search */

  const Search = {
    hits: [], pos: -1, term: '',

    run(term, app) {
      this.term = term.trim();
      const q = this.term.toLowerCase();
      this.hits = [];
      if (q.length >= 2) {
        const msgs = app.messages;
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i];
          if (m.body && m.body.toLowerCase().includes(q)) this.hits.push(i);
          else if (m.sender && m.files && m.sender.toLowerCase().includes(q)) this.hits.push(i);
        }
      }
      this.pos = this.hits.length ? this.hits.length - 1 : -1;
      global.Renderer.state.highlight = q.length >= 2 ? this.term : '';
      app.redraw();
      this.updateCount();
      return this.hits;
    },

    updateCount() {
      $('searchCount').textContent = !this.term ? ''
        : this.hits.length ? (this.pos + 1) + '/' + this.hits.length
        : t('s.none');
    },

    step(delta, app) {
      if (!this.hits.length) return;
      this.pos = (this.pos + delta + this.hits.length) % this.hits.length;
      app.jumpTo(this.hits[this.pos]);
      this.updateCount();
    },

    /** List of hits, each with a preview snippet, shown in the side panel. */
    panel(app) {
      const box = el('div', 'results');
      if (!this.hits.length) {
        box.appendChild(el('div', 'empty', this.term
          ? Fmt.escapeHtml(t('s.nomatch', { q: this.term }))
          : t('s.short')));
        return box;
      }
      const max = Math.min(this.hits.length, 400);
      for (let k = 0; k < max; k++) {
        const i = this.hits[k];
        const m = app.messages[i];
        const b = el('button', 'result');
        b.type = 'button';
        b.innerHTML =
          '<span class="r-top"><span class="r-who"></span><span class="r-when"></span></span>' +
          '<span class="r-txt"></span>';
        b.querySelector('.r-who').textContent = m.sender || '';
        b.querySelector('.r-when').textContent = Fmt.shortDate(m.t) + ' ' + Fmt.time(m.t);
        b.querySelector('.r-txt').innerHTML = Fmt.richText(snippet(m.body, this.term), this.term)
          .replace(/<a [^>]*>|<\/a>/g, '');
        b.addEventListener('click', () => {
          this.pos = k;
          this.updateCount();
          app.jumpTo(i);
          if (global.matchMedia('(max-width:640px)').matches) Panel.close();
        });
        box.appendChild(b);
      }
      if (this.hits.length > max) {
        box.appendChild(el('div', 'empty', t('s.firstN', { n: max, tot: this.hits.length })));
      }
      return box;
    },
  };

  function snippet(text, term) {
    if (!text) return '';
    const i = text.toLowerCase().indexOf(term.toLowerCase());
    if (i < 60) return text.slice(0, 180);
    return '…' + text.slice(i - 40, i + 140);
  }

  /* ========================================================== statistics */

  function statsPanel(app) {
    const msgs = app.messages;
    const box = el('div');

    const perSender = new Map();
    const perDay = new Map();
    const kinds = { image: 0, video: 0, audio: 0, sticker: 0, doc: 0, vcard: 0 };
    const emoji = new Map();
    const RE_EMO = /\p{Extended_Pictographic}/gu;
    let words = 0, chars = 0, media = 0, sysN = 0;

    for (const m of msgs) {
      if (m.sys) { sysN++; continue; }
      perSender.set(m.sender, (perSender.get(m.sender) || 0) + 1);
      const dk = Fmt.dayKey(m.t);
      perDay.set(dk, (perDay.get(dk) || 0) + 1);
      if (m.files) { media += m.files.length; for (const f of m.files) kinds[Media.kindOf(f.base)]++; }
      if (m.body) {
        chars += m.body.length;
        words += m.body.split(/\s+/).filter(Boolean).length;
        const em = m.body.match(RE_EMO);
        if (em) for (const e of em) emoji.set(e, (emoji.get(e) || 0) + 1);
      }
    }

    const days = perDay.size || 1;
    const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const first = msgs[0], last = msgs[msgs.length - 1];

    const grid = el('div', 'stat-grid');
    const stat = (n, k) => {
      const s = el('div', 'stat', '<div class="n"></div><div class="k"></div>');
      s.querySelector('.n').textContent = n;
      s.querySelector('.k').textContent = k;
      return s;
    };
    grid.append(
      stat((msgs.length - sysN).toLocaleString(Fmt.LOCALE), t('st.messages')),
      stat(media.toLocaleString(Fmt.LOCALE), t('st.media')),
      stat(days.toLocaleString(Fmt.LOCALE), t('st.days')),
      stat(Math.round((msgs.length - sysN) / days).toLocaleString(Fmt.LOCALE), t('st.perDay')),
      stat(words.toLocaleString(Fmt.LOCALE), t('st.words')),
      stat(Math.round(chars / Math.max(1, msgs.length - sysN - media)), t('st.charsPerMsg')),
    );
    box.appendChild(grid);

    box.appendChild(el('div', 'field-title', t('st.perPerson')));
    const top = [...perSender.entries()].sort((a, b) => b[1] - a[1]);
    const maxN = top.length ? top[0][1] : 1;
    for (const [name, n] of top) {
      const r = el('div', 'bar-row', '<div class="bl"><span></span><span></span></div><div class="bar"><i></i></div>');
      r.querySelectorAll('.bl span')[0].textContent = name;
      r.querySelectorAll('.bl span')[1].textContent = n.toLocaleString(Fmt.LOCALE) +
        '  ·  ' + Math.round(n * 100 / Math.max(1, msgs.length - sysN)) + '%';
      const bar = r.querySelector('.bar i');
      bar.style.width = (n * 100 / maxN) + '%';
      bar.style.background = Fmt.colorFor(name);
      box.appendChild(r);
    }

    const kindLabels = { image: t('k.image'), video: t('k.video'), audio: t('k.audio'),
                         sticker: t('k.sticker'), doc: t('k.doc'), vcard: t('k.vcard') };
    const present = Object.entries(kinds).filter(([, n]) => n > 0);
    if (present.length) {
      box.appendChild(el('div', 'field-title', t('st.kinds')));
      const kmax = Math.max(...present.map(([, n]) => n));
      for (const [k, n] of present.sort((a, b) => b[1] - a[1])) {
        const r = el('div', 'bar-row', '<div class="bl"><span></span><span></span></div><div class="bar"><i></i></div>');
        r.querySelectorAll('.bl span')[0].textContent = kindLabels[k];
        r.querySelectorAll('.bl span')[1].textContent = n;
        r.querySelector('.bar i').style.width = (n * 100 / kmax) + '%';
        box.appendChild(r);
      }
    }

    const topEmoji = [...emoji.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topEmoji.length) {
      box.appendChild(el('div', 'field-title', t('st.emoji')));
      const line = el('div', 'chips');
      for (const [e, n] of topEmoji) line.appendChild(el('span', 'chip', Fmt.escapeHtml(e) + ' ' + n));
      box.appendChild(line);
    }

    box.appendChild(el('div', 'field-title', t('st.period')));
    const info = el('div');
    info.style.cssText = 'font-size:13.6px;color:var(--text-muted);line-height:1.8';
    info.innerHTML =
      t('st.first') + ': <b>' + Fmt.fullDate(first.t) + '</b><br>' +
      t('st.last') + ': <b>' + Fmt.fullDate(last.t) + '</b><br>' +
      (busiest ? t('st.busiest') + ': <b>' + Fmt.dayLabel(dayFromKey(busiest[0])) + '</b> (' +
                 t('st.msgs', { n: busiest[1] }) + ')' : '');
    box.appendChild(info);

    return box;
  }

  const dayFromKey = (k) => new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100, k % 100).getTime();

  /* ============================================================ settings */

  function settingsPanel(app) {
    const box = el('div');

    /* --- who you are --- */
    const f1 = el('div', 'field');
    f1.appendChild(el('label', null, t('set.you')));
    const chips = el('div', 'chips');
    for (const p of app.participants) {
      const c = el('button', 'chip' + (p.name === app.me ? ' on' : ''));
      c.type = 'button';
      c.textContent = p.name;
      c.addEventListener('click', () => {
        app.setMe(p.name);
        chips.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.textContent === p.name));
      });
      chips.appendChild(c);
    }
    f1.appendChild(chips);
    f1.appendChild(el('div', 'hint', t('set.youHint')));
    box.appendChild(f1);

    /* --- theme --- */
    const f2 = el('div', 'field');
    f2.appendChild(el('label', null, t('set.look')));
    const themes = [['auto', t('set.auto')], ['light', t('set.light')], ['dark', t('set.dark')]];
    const tc = el('div', 'chips');
    for (const [v, label] of themes) {
      const c = el('button', 'chip' + (app.theme === v ? ' on' : ''));
      c.type = 'button';
      c.textContent = label;
      c.addEventListener('click', () => {
        app.setTheme(v);
        tc.querySelectorAll('.chip').forEach((x, k) => x.classList.toggle('on', themes[k][0] === v));
      });
      tc.appendChild(c);
    }
    f2.appendChild(tc);
    box.appendChild(f2);

    /* --- interface language --- */
    const fl = el('div', 'field');
    fl.appendChild(el('label', null, t('set.lang')));
    const lsel = el('select');
    for (const { code, name } of global.I18n.list) {
      const o = document.createElement('option');
      o.value = code; o.textContent = name;
      o.selected = code === global.I18n.lang;
      lsel.appendChild(o);
    }
    lsel.addEventListener('change', () => {
      global.I18n.setLang(lsel.value);
      Panel.open(t('pan.settings'), settingsPanel(app));
    });
    fl.appendChild(lsel);
    box.appendChild(fl);

    /* --- jump to date --- */
    const f3 = el('div', 'field');
    f3.appendChild(el('label', null, t('set.goto')));
    const dr = el('div', 'row-opt');
    const input = el('input');
    input.type = 'date';
    const lo = new Date(app.messages[0].t), hi = new Date(app.messages[app.messages.length - 1].t);
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    input.min = iso(lo); input.max = iso(hi); input.value = iso(hi);
    const go = el('button', 'chip', t('set.go'));
    go.type = 'button';
    go.addEventListener('click', () => {
      const [y, m, d] = input.value.split('-').map(Number);
      const key = y * 10000 + (m - 1) * 100 + d;
      let idx = app.messages.findIndex(x => Fmt.dayKey(x.t) >= key);
      if (idx < 0) idx = app.messages.length - 1;
      app.jumpTo(idx, 'start');
      if (global.matchMedia('(max-width:640px)').matches) Panel.close();
    });
    dr.append(input, go);
    f3.appendChild(dr);
    box.appendChild(f3);

    /* --- date order --- */
    const f4 = el('div', 'field');
    f4.appendChild(el('label', null, t('set.order')));
    const sel = el('select');
    for (const [v, label] of [['auto', t('set.orderAuto')], ['dmy', t('set.dmy')], ['mdy', t('set.mdy')], ['ymd', t('set.ymd')]]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      o.selected = (app.dateOrderPref || 'auto') === v;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => app.reparse(sel.value));
    f4.appendChild(sel);
    f4.appendChild(el('div', 'hint', t('set.orderHint', {
      v: ({ dmy: t('set.dmy'), mdy: t('set.mdy'), ymd: t('set.ymd') })[app.dateOrder],
    })));
    box.appendChild(f4);

    /* --- archive summary --- */
    const f5 = el('div', 'field');
    f5.appendChild(el('label', null, t('set.archive')));
    const sum = el('div');
    sum.style.cssText = 'font-size:13.4px;color:var(--text-muted);line-height:1.7';
    sum.innerHTML = Fmt.escapeHtml(app.archiveName) + '<br>' + t('set.files', {
      n: app.messages.length.toLocaleString(Fmt.LOCALE),
      f: Math.max(0, app.archive.entries.length - 1).toLocaleString(Fmt.LOCALE),
    });
    f5.appendChild(sum);
    const close = el('button', 'chip', t('set.closeChat'));
    close.type = 'button';
    close.style.marginTop = '12px';
    close.addEventListener('click', () => { Panel.close(); app.reset(); });
    f5.appendChild(close);
    box.appendChild(f5);

    return box;
  }

  /* ============================================================ lightbox */

  const Lightbox = {
    items: [], idx: -1,

    setGallery(items) { this.items = items; },

    open(entry) {
      this.idx = this.items.findIndex(e => e.name === entry.name);
      if (this.idx < 0) { this.items = [entry]; this.idx = 0; }
      $('lightbox').hidden = false;
      this.show();
    },

    show() {
      const entry = this.items[this.idx];
      const stage = $('lbStage');
      stage.innerHTML = '';
      $('lbTitle').textContent = Media.prettyName(entry.base) +
        (this.items.length > 1 ? '  ·  ' + (this.idx + 1) + ' di ' + this.items.length : '');
      const kind = Media.kindOf(entry.base);
      const node = document.createElement(kind === 'video' ? 'video' : 'img');
      if (kind === 'video') { node.controls = true; node.autoplay = true; node.playsInline = true; }
      stage.appendChild(node);
      global.App.store.url(entry).then(u => {
        node.src = u;
        $('lbDownload').href = u;
        $('lbDownload').download = Media.prettyName(entry.base);
      });
      const many = this.items.length > 1;
      $('lbPrev').hidden = !many;
      $('lbNext').hidden = !many;
    },

    step(d) {
      if (this.items.length < 2) return;
      this.idx = (this.idx + d + this.items.length) % this.items.length;
      this.show();
    },

    close() {
      $('lightbox').hidden = true;
      $('lbStage').innerHTML = '';
    },

    get isOpen() { return !$('lightbox').hidden; },
  };

  global.Panels = { Panel, Search, statsPanel, settingsPanel };
  global.Lightbox = Lightbox;
})(window);
