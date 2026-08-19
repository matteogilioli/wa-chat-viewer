/* ==========================================================================
   format.js — text, dates and small presentation helpers.
   ========================================================================== */
(function (global) {
  'use strict';

  // Date formatters follow the interface language and are rebuilt when it changes.
  const OPTS = {
    time: { hour: '2-digit', minute: '2-digit' },
    day: { day: 'numeric', month: 'long', year: 'numeric' },
    dayShort: { day: '2-digit', month: '2-digit', year: 'numeric' },
    full: { dateStyle: 'medium', timeStyle: 'short' },
  };
  let cache = {}, cacheLocale = null;
  function fmt(kind) {
    const loc = locale();
    if (loc !== cacheLocale) { cache = {}; cacheLocale = loc; }
    return cache[kind] || (cache[kind] = new Intl.DateTimeFormat(loc, OPTS[kind]));
  }
  const locale = () => (global.I18n && global.I18n.locale) || 'en-GB';

  const time = (t) => fmt('time').format(t);
  const fullDate = (t) => fmt('full').format(t);
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };

  function dayLabel(t) {
    const k = dayKey(t), today = dayKey(Date.now()), yest = dayKey(Date.now() - 864e5);
    const T = (key) => (global.I18n ? global.I18n.t(key) : key);
    if (k === today) return T('d.today');
    if (k === yest) return T('d.yesterday');
    const s = fmt('day').format(t);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const shortDate = (t) => fmt('dayShort').format(t);

  /* --------------------------------------------------------------- text */

  const escapeHtml = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const RE_URL = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;
  const RE_MAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/gi;
  // Mentions: WhatsApp writes them as «@Name» (or «@number») and shows them in
  // blue. The name has to be looked up among the participants, otherwise there
  // is no telling where it ends: «@Anna Rossi are you coming?» has a space
  // inside the name as well.
  let RE_MENTION = null;
  function setMentions(names) {
    const parts = (names || [])
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(n => escapeRe(escapeHtml(n)));
    parts.push('\\d{6,}');
    RE_MENTION = new RegExp('@(' + parts.join('|') + ')', 'g');
  }

  const RE_EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|[\u200d\ufe0f\s])+$/u;

  /** true if the message is nothing but a few emoji (transparent bubble). */
  function isEmojiOnly(s) {
    if (!s || s.length > 24) return false;
    if (!RE_EMOJI_ONLY.test(s)) return false;
    return [...s.replace(/[\s\ufe0f\u200d]/gu, '')].length <= 8;
  }

  /**
   * Turns the message text into HTML: clickable links, WhatsApp formatting
   * (*bold*, _italic_, ~strikethrough~, ```code```) and highlighting of the
   * searched term.
   */
  function richText(raw, highlight) {
    const slots = [];
    const NUL = '\u0001';
    const park = (html) => NUL + (slots.push(html) - 1) + NUL;

    let s = escapeHtml(raw);

    // Code blocks and links are put away "in the safe" so the formatting rules
    // applied right after can't touch them.
    s = s.replace(/```([\s\S]+?)```/g, (_, c) => park('<pre>' + c + '</pre>'));
    s = s.replace(/`([^`\n]+)`/g, (_, c) => park('<code>' + c + '</code>'));
    s = s.replace(RE_URL, (u) => {
      const href = /^www\./i.test(u) ? 'https://' + u : u;
      return park('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
    });
    s = s.replace(RE_MAIL, (m) => park('<a href="mailto:' + m + '">' + m + '</a>'));
    if (RE_MENTION) s = s.replace(RE_MENTION, (m) => park('<span class="mention">' + m + '</span>'));

    s = s.replace(/(^|[^\w*])\*([^\s*][^*]*?)\*(?![\w*])/g, '$1<b>$2</b>');
    s = s.replace(/(^|[^\w_])_([^\s_][^_]*?)_(?![\w_])/g, '$1<i>$2</i>');
    s = s.replace(/(^|[^\w~])~([^\s~][^~]*?)~(?![\w~])/g, '$1<s>$2</s>');

    if (highlight) {
      const re = new RegExp('(' + escapeRe(escapeHtml(highlight)) + ')', 'gi');
      s = s.replace(re, '<mark>$1</mark>');
    }

    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => slots[+i]);
  }

  /* ----------------------------------------------------------- identity */

  const AVATAR_COLORS = ['#e5766b', '#d98c3f', '#c4a63b', '#6fa84f', '#3fa89b', '#4a8fd0',
                         '#7a7fd4', '#b06fc4', '#c26a94', '#8b7355', '#5b8c85', '#a4693f'];

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  const colorFor = (name) => AVATAR_COLORS[hash(name || '?') % AVATAR_COLORS.length];

  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(w => /\p{L}/u.test(w[0] || ''));
    if (!parts.length) return name.trim().slice(0, 2).toUpperCase();
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  /* --------------------------------------------------------------- misc */

  function bytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' kB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }

  function duration(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  global.Fmt = {
    time, dayLabel, dayKey, shortDate, fullDate, richText, escapeHtml, escapeRe,
    isEmojiOnly, colorFor, initials, bytes, duration, hash, setMentions,
    get LOCALE() { return locale(); },
  };
})(window);
