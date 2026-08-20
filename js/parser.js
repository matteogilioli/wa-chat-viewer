/* ==========================================================================
   parser.js — turns WhatsApp's _chat.txt into structured messages.

   Handles the iOS and Android export formats, 12/24h clocks, day/month and
   month/day date orders, and attachments whose labels are localized in any
   language (recognition works by matching the file names actually present in
   the archive, not by translating the labels).
   ========================================================================== */
(function (global) {
  'use strict';

  // Text-direction markers that iOS sprinkles all over the export.
  const BIDI = /[‎‏‪-‮⁦-⁩]/g;

  // Arabic-Indic and Persian digits used by Arabic/Farsi exports. The
  // substitution is 1:1, so offsets into the text stay aligned.
  const RE_EAST_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;
  const RE_HAS_EAST = /[\u0660-\u0669\u06f0-\u06f9]/;
  const normDigits = (s) => RE_HAS_EAST.test(s)
    ? s.replace(RE_EAST_DIGITS, (c) => {
        const n = c.charCodeAt(0);
        return String(n >= 0x06f0 ? n - 0x06f0 : n - 0x0660);
      })
    : s;

  // Header line. It has to cope with every variant WhatsApp produces across
  // languages and operating systems:
  //   [02/04/26, 13:00:15] Nome:      iOS 24h        02/04/2026, 13:00 - Nome:   Android
  //   [4/2/26, 1:00:15 PM] Name:      iOS 12h        2/4/26 1:00 p. m. - Nombre: Spanish
  //   02.04.26, 13:00 - Name:         German         2.4.2026 klo 13.00 - Nimi:  Finnish
  //   2026-04-02 13:00 - Namn:        Swedish        2026. 4. 2. 오후 1:00 - 이름:   Korean
  //   2026/4/2 下午1:00 - 名字:           Chinese        ٢/٤/٢٠٢٦ ١:٠٠ م - الاسم:    Arabic
  const RE_HEAD = new RegExp(
    '^[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*' +
    '\\[?[\\s\\u00a0]*' +
    '(\\d{1,4})[./-][\\s\\u00a0]?(\\d{1,4})[./-][\\s\\u00a0]?(\\d{1,4})' + // 1,2,3 = date
    '[,.]?' +
    '([^\\d\\n]{0,12}?)' +                                                  // 4 = filler: " klo ", " 下午", " 오후 "
    '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?' +                            // 5,6,7 = h, m, s
    '(?:[\\s\\u00a0\\u202f]*([APap]\\.?[\\s\\u00a0]?[Mm]\\.?|[\\u0635\\u0645]))?' + // 8 = AM/PM
    '[\\s\\u00a0]*\\]?' +
    '(?:[\\s\\u00a0]*[-\\u2013\\u2014][\\s\\u00a0]+|[\\s\\u00a0]+)'
  );

  // File name "without spaces" (the common case: IMG-2021…-WA0001.jpg).
  const EXT = 'jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|mp4|3gpp?|mov|mkv|avi|webm|m4v|' +
              'opus|m4a|mp3|ogg|oga|aac|wav|amr|caf|flac|pdf|docx?|xlsx?|pptx?|pages|numbers|' +
              'txt|rtf|csv|zip|rar|7z|apk|vcf|epub|json|xml|svg';
  const RE_TOKEN  = new RegExp('[^\\s"\'<>()\\[\\]]+\\.(?:' + EXT + ')\\b', 'gi');
  // iOS: «<attachment: NAME>» in any language.
  const RE_ANGLE  = /<[^<>]{0,40}?[:：]\s*([^<>]+?)\s*>/;
  // Android: «NAME.ext (file attached)», or just the name on the first line.
  const RE_ANDROID = new RegExp('^\\s*(.+?\\.(?:' + EXT + '))\\s*(?:\\([^)]*\\))?\\s*$', 'i');
  // Sender: «Name: text». The name may contain invisible markers.
  // The body can be empty: WhatsApp also exports «Name:» lines with nothing
  // after them, and those belong to that person, not to the system messages.
  const RE_SENDER = /^[\u200e\u200f\u202a-\u202e\u2066-\u2069]*([^:\n]{1,100}?):(?:[\s\u00a0]([\s\S]*))?$/;
  // Variant with mandatory parentheses: it spots an attachment when the file
  // is NOT in the archive, without mistaking a message that merely names a
  // file for an attachment.
  const RE_ANDROID_TAGGED = new RegExp('^\\s*(.+?\\.(?:' + EXT + '))\\s*\\([^)]*\\)\\s*$', 'i');

  const RE_LOCATION = /https?:\/\/maps\.google\.com\/\?q=(-?\d+\.\d+),(-?\d+\.\d+)/i;
  // Numeric prefix that iOS puts in front of the file names in the archive.
  const RE_PREFIX = /^\d{6,}-/;

  /* --------------------------------------------------------------- dates */

  /**
   * Works out whether dates are day/month or month/day.
   *
   * First test, and the decisive one: a single value > 12 in either position
   * settles it. If every date is ambiguous (an American export covering a
   * single month, say) we lean on the fact that messages are in chronological
   * order: try each reading and keep the one with fewer jumps backwards.
   */
  function detectOrder(samples) {
    let dmy = 0, mdy = 0, ymd = 0;
    for (const s of samples) {
      if (s[0] > 31) { ymd++; continue; }
      if (s[0] > 12) dmy++;
      else if (s[1] > 12) mdy++;
    }
    if (ymd > dmy && ymd > mdy) return 'ymd';
    if (dmy || mdy) return dmy >= mdy ? 'dmy' : 'mdy';
    return violations(samples, 'dmy') <= violations(samples, 'mdy') ? 'dmy' : 'mdy';
  }

  /** How often the date "goes backwards" (or is impossible) under this order. */
  function violations(samples, order) {
    let bad = 0, prev = -Infinity;
    for (const s of samples) {
      const d = order === 'mdy' ? s[1] : s[0];
      const mo = order === 'mdy' ? s[0] : s[1];
      let y = s[2];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      if (mo > 12 || d > 31) { bad++; continue; }
      const v = y * 10000 + mo * 100 + d;
      if (v < prev) bad++;
      prev = v;
    }
    return bad;
  }

  // Instead of AM/PM, some languages put a marker before the time.
  const RE_PM_WORD = /下午|午後|오후|\u0645/;
  const RE_AM_WORD = /上午|午前|오전|\u0635/;

  /** true = afternoon, false = morning, null = 24-hour clock. */
  function meridiem(ampm, filler) {
    if (ampm) {
      if (/^[pP]/.test(ampm) || RE_PM_WORD.test(ampm)) return true;
      if (/^[aA]/.test(ampm) || RE_AM_WORD.test(ampm)) return false;
    }
    if (filler) {
      if (RE_PM_WORD.test(filler)) return true;
      if (RE_AM_WORD.test(filler)) return false;
    }
    return null;
  }

  function buildDate(a, b, c, hh, mm, ss, pm, order) {
    let d, mo, y;
    if (order === 'ymd') { y = a; mo = b; d = c; }
    else if (order === 'mdy') { mo = a; d = b; y = c; }
    else { d = a; mo = b; y = c; }
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let h = hh;
    if (pm !== null) h = (h % 12) + (pm ? 12 : 0);
    return new Date(y, mo - 1, d, h, mm, ss || 0).getTime();
  }

  /* --------------------------------------------------------- attachments */

  function normKey(s) {
    return String(s).replace(BIDI, '').trim().toLowerCase();
  }

  /**
   * Looks through the message body for file names that really are in the
   * archive and strips them out, leaving only the caption, if any.
   */
  function extractAttachments(body, fileMap) {
    if (!fileMap || !fileMap.size) return null;
    const found = [];
    let rest = body;

    const take = (raw) => {
      const key = normKey(raw);
      const hit = fileMap.get(key) || fileMap.get(key.replace(/^.*\//, ''));
      if (hit && !found.includes(hit)) { found.push(hit); return true; }
      return false;
    };

    // 1) iOS format: <attachment: name>
    let m = RE_ANGLE.exec(rest);
    if (m && take(m[1])) rest = rest.replace(m[0], '');

    // 2) Android format: the first line is "name.ext (file attached)"
    if (!found.length) {
      const lines = rest.split('\n');
      const am = RE_ANDROID.exec(lines[0].replace(BIDI, ''));
      if (am && take(am[1])) { lines.shift(); rest = lines.join('\n'); }
    }

    // 3) safety net: a recognizable file name anywhere in the text
    if (!found.length) {
      RE_TOKEN.lastIndex = 0;
      let t;
      while ((t = RE_TOKEN.exec(rest))) {
        if (take(t[0])) { rest = rest.replace(t[0], ''); RE_TOKEN.lastIndex = 0; }
      }
    }

    if (!found.length) return null;
    // clean up what the marker left behind (empty angle brackets, spaces)
    rest = rest.replace(/<\s*[^<>]{0,40}[:：]?\s*>/g, '').replace(BIDI, '').trim();
    return { files: found, caption: rest };
  }

  // Poll. WhatsApp exports «POLL: question» followed by one line
  // «OPTION: answer (N votes)» per choice — except sometimes it puts the
  // whole thing on a single line. The labels are translated, the shape isn't:
  // a word followed by a colon, repeated identically, with the count in
  // parentheses. Colons are banned inside the option text, otherwise a time
  // like «19:00» would be taken for the label.
  const RE_POLL_OPT = /(?:^|\s)([^\s:]{2,24}):[ \t]*([^()\n:]+?)[ \t]*\((\d+)[^)]*\)/g;

  function parsePoll(body) {
    const text = body.replace(BIDI, '').trim();
    const firstColon = text.indexOf(':');
    if (firstColon < 2 || firstColon > 24) return null;
    const questionLabel = text.slice(0, firstColon).trim();
    if (/\s/.test(questionLabel)) return null;

    RE_POLL_OPT.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = RE_POLL_OPT.exec(text))) {
      matches.push({ label: m[1], text: m[2].trim(), votes: +m[3], at: m.index });
    }
    if (matches.length < 2) return null;

    // the option label is the one that repeats, and it isn't the question's
    const counts = new Map();
    for (const o of matches) counts.set(o.label, (counts.get(o.label) || 0) + 1);
    let optionLabel = null;
    for (const [k, n] of counts) if (n >= 2 && k !== questionLabel) optionLabel = k;
    if (!optionLabel) return null;

    const options = matches.filter(o => o.label === optionLabel);
    if (options.length < 2) return null;

    const question = text.slice(firstColon + 1, options[0].at).trim();
    if (!question) return null;
    return { question, options: options.map(({ text, votes }) => ({ text, votes })) };
  }

  /**
   * A reference to an attachment whose file isn't in the archive: it happens
   * with «without media» exports and when WhatsApp truncates attachments.
   */
  function attachmentRef(body) {
    const clean = body.replace(BIDI, '');
    const a = RE_ANGLE.exec(clean);
    if (a && /\.[a-z0-9]{2,5}\s*$/i.test(a[1])) return a[1].trim();
    const b = RE_ANDROID_TAGGED.exec(clean.split('\n')[0]);
    return b ? b[1].trim() : null;
  }

  /* --------------------------------------------------------------- parse */

  /**
   * @param {string} text   contents of _chat.txt
   * @param {Map}    fileMap  lowercase file name -> archive entry
   * @param {object} opts   { order: 'auto'|'dmy'|'mdy'|'ymd', onProgress }
   */
  async function parse(text, fileMap, opts) {
    opts = opts || {};
    const lines = text.split(/\r\n|\r|\n/);

    /* ----------- pass 1: headers, raw dates, sender frequency ----------- */
    const heads = new Array(lines.length);
    const dateSamples = [];
    const senderCount = new Map();

    for (let i = 0; i < lines.length; i++) {
      // Eastern digits are converted only to pick out the date and time: the
      // message body is then sliced out of the original line.
      const m = RE_HEAD.exec(normDigits(lines[i]));
      if (!m) continue;
      heads[i] = m;
      dateSamples.push([+m[1], +m[2], +m[3]]);
      const rest = lines[i].slice(m[0].length);
      const c = /^([^:\n]{1,100}):[\s ]/.exec(rest.replace(BIDI, ''));
      if (c) {
        const k = c[1].trim();
        senderCount.set(k, (senderCount.get(k) || 0) + 1);
      }
    }

    const order = (!opts.order || opts.order === 'auto') ? detectOrder(dateSamples) : opts.order;

    /** A candidate is a real sender if it recurs, or if it is short and free
     *  of sentence punctuation (system messages are long and unique). */
    const isSender = (name) => {
      const n = senderCount.get(name) || 0;
      if (n >= 2) return true;
      return name.length <= 40 && !/[.!?]/.test(name);
    };

    /* --------------------- pass 2: building messages -------------------- */
    const messages = [];
    const participants = new Map();
    let cur = null;
    const flush = () => {
      if (!cur) return;
      messages.push(cur);
      cur = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const m = heads[i];
      if (!m) {
        if (cur) cur.body += '\n' + lines[i];
        continue;                       // orphan line before the first message
      }
      flush();

      const t = buildDate(+m[1], +m[2], +m[3], +m[5], +m[6], m[7] ? +m[7] : 0,
                          meridiem(m[8], m[4]), order);
      // The name needs its direction markers stripped, the body doesn't: the
      // invisible character up front is what says WhatsApp wrote the text.
      const rest = lines[i].slice(m[0].length);
      const c = RE_SENDER.exec(rest);
      const name = c ? c[1].replace(BIDI, '').trim() : null;

      if (name && isSender(name)) {
        cur = { t, sender: name, body: c[2] || '', sys: false, i: 0 };
      } else {
        cur = { t, sender: null, body: rest, sys: true, i: 0 };
      }

      if ((i & 8191) === 0 && opts.onProgress) {
        opts.onProgress(i / lines.length);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    flush();

    // The texts WhatsApp generates repeat word for word throughout the chat,
    // the ones a person writes almost never do: frequency is what tells «This
    // message was deleted» from «I deleted the photo off my phone».
    // Names seen as senders: in groups the group name and entries like «You»
    // show up too, and they are what makes events recognizable («You added X»).
    const knownNames = [...senderCount.keys()].filter(n => n.length >= 3);

    const frequency = new Map();
    for (const m of messages) {
      const k = shortKey(m.body);
      if (k) frequency.set(k, (frequency.get(k) || 0) + 1);
    }
    messages.forEach((msg, k) => finalize(msg, fileMap, k === 0, frequency, knownNames));

    // A line can end up with no content at all: «Name:» and nothing else, or a
    // body made only of invisible characters. There is nothing to show, so the
    // message is dropped rather than drawn as an empty bubble.
    // no push(...array): with hundreds of thousands of elements the spread
    // passes one argument per message and blows the stack
    const visible = messages.filter(msg => !isEmpty(msg));

    visible.forEach((msg, k) => {
      msg.i = k;
      const real = !msg.sys && msg.sender && (!msg.auto || msg.files);
      if (real) participants.set(msg.sender, (participants.get(msg.sender) || 0) + 1);
    });

    return {
      messages: visible,
      participants: [...participants.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      order,
    };
  }

  /** Comparison key for short texts (used to count how often they repeat). */
  function shortKey(body) {
    const t = String(body).replace(BIDI, '').trim().toLowerCase();
    return t.length && t.length <= 80 ? t : null;
  }

  /**
   * Finishes a message off: attachments, status (deleted, edited, media not
   * exported, call, system notice), location.
   *
   * Order matters: first recognize what has a dependable shape (attachment,
   * location), then interpret the rest. Deciding «WhatsApp wrote this text,
   * not the user» is structural and therefore language-independent; the
   * vocabulary only picks between deleted, call, notice and missing media.
   */
  function finalize(msg, fileMap, first, frequency, knownNames) {
    const M = global.Markers;
    let body = msg.body;

    // Has to be read before touching the body: it says WhatsApp wrote the
    // text, not the person.
    const generated = M.isGenerated(body);
    if (generated) msg.auto = true;

    if (!msg.sys) {
      const att = extractAttachments(body, fileMap);
      if (att) { msg.files = att.files; body = att.caption; }
    }

    // Edit marker: at the end, in angle brackets. Checked after attachments
    // (those are in angle brackets too) and only if it isn't the whole
    // message, which would instead be media that wasn't exported.
    const em = M.TRAILING_TAG.exec(body);
    if (em && em.index > 0 && (M.isEdited(em[0]) || em[0].length <= 60)) {
      msg.edited = true;
      body = body.slice(0, em.index);
    }

    body = body.replace(BIDI, '').trim();

    const loc = RE_LOCATION.exec(body);
    if (loc) msg.loc = { lat: loc[1], lng: loc[2], url: loc[0] };

    // must be checked before the rest: a poll is flagged as «generated» and
    // would end up among the system notices
    if (!msg.files && !msg.loc) {
      const poll = parsePoll(body);
      if (poll) { msg.poll = poll; body = ''; }
    }

    if (!msg.files && !msg.loc && !msg.poll) {
      const ref = attachmentRef(msg.body);
      if (ref) {
        msg.omitted = true;
        msg.missingName = ref;
        body = '';
      } else if (M.isDeleted(body) && (generated || isRepeated(body, frequency))) {
        msg.deleted = true;
      } else if (generated && body.length <= 200) {
        if (M.isEncryptionNotice(body) || M.isContactNotice(body)) {
          msg.sys = true;
          msg.security = true;      // only these get the yellow background
        } else if (M.isCall(body)) {
          msg.call = M.isVideoCall(body) ? 'video' : 'voice';
          msg.callMissed = M.isMissedCall(body);
        } else if (M.isViewOnce(body)) {
          // «view once photo»: the file is never in the archive
          msg.omitted = true;
          msg.viewOnce = true;
          msg.omittedKind = M.kindOfText(body);
        } else if (M.isOmitted(body)) {
          msg.omitted = true;
          msg.omittedKind = M.kindOfText(body);
        } else if (body.length <= 40 && M.kindOfText(body) !== 'media') {
          // names a media type and is short: it's a placeholder («video omitted»).
          // A long sentence that mentions «film» or «photo» is another matter.
          msg.omitted = true;
          msg.omittedKind = M.kindOfText(body);
        } else {
          // names neither a media type nor a known action: it's a chat event
          // («You created the group», «You changed the icon», «X joined»)
          msg.sys = true;
        }
      }
    }

    // iOS repeats the document's name and size as the message text: better
    // used as the card's subtitle than as a caption.
    if (msg.files && msg.files.length === 1 && body) {
      const pretty = msg.files[0].base.replace(RE_PREFIX, '');
      const withoutExt = pretty.replace(/\.[^.]+$/, '');
      if (body.indexOf(pretty) === 0 || body.indexOf(withoutExt) === 0) {
        msg.docName = pretty;
        msg.docMeta = body.slice(pretty.length).replace(/^[\s•·|-]+/, '');
        body = '';
      }
    }

    msg.body = body;
  }

  /** Does the message have nothing to show? */
  function isEmpty(msg) {
    return !msg.body && !msg.files && !msg.poll && !msg.loc &&
           !msg.deleted && !msg.omitted && !msg.call && !msg.missingName;
  }

  /** Does the text name a participant (or the group)? */
  function mentionsSomeone(body, knownNames) {
    if (!knownNames) return false;
    for (const n of knownNames) if (body.includes(n)) return true;
    return false;
  }

  /** Android has no invisible marker: fall back on repetition. */
  function isRepeated(body, frequency) {
    if (!frequency || body.length > 60) return false;
    const k = shortKey(body);
    return !!k && (frequency.get(k) || 0) >= 2;
  }

  global.Parser = { parse, detectOrder, BIDI };
})(window);
