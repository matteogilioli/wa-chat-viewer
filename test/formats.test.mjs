/* ==========================================================================
   formats.test.mjs — runs the parser against the exports WhatsApp produces
   in various languages and on both operating systems.

       node test/formats.test.mjs

   Each case is a minimal conversation with its expected result: local date and
   time, sender, body, attachments. If a line isn't recognized the test fails.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
global.window = {};
for (const f of ['markers', 'parser']) new Function(fs.readFileSync(`${root}/js/${f}.js`, 'utf8')).call(global);
const { Parser } = window;

const NBSP = ' ', NNBSP = ' ', LRM = '‎', RLM = '‏';

/** local date/time as "YYYY-MM-DD hh:mm:ss" */
const stamp = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const CASES = [
  {
    name: 'iOS Italian, 24-hour clock',
    text: [
      `[02/04/26, 13:00:15] Mario Rossi: Ciao`,
      `[02/04/26, 13:01:00] Anna Bianchi: Ciao!`,
    ],
    expected: [['2026-04-02 13:00:15', 'Mario Rossi', 'Ciao'], ['2026-04-02 13:01:00', 'Anna Bianchi', 'Ciao!']],
  },
  {
    name: 'iOS US English, 12-hour clock',
    text: [
      `[4/2/26, 1:00:15 PM] John: Afternoon`,
      `[4/17/26, 11:05:00 AM] Jane: Morning`,
    ],
    expected: [['2026-04-02 13:00:15', 'John', 'Afternoon'], ['2026-04-17 11:05:00', 'Jane', 'Morning']],
  },
  {
    name: 'iOS with a narrow space before PM (iOS 17+)',
    text: [`[4/17/26, 1:00:15${NNBSP}PM] John: Hi`],
    expected: [['2026-04-17 13:00:15', 'John', 'Hi']],
  },
  {
    name: 'Android Italian',
    text: [`02/04/2026, 13:00 - Mario Rossi: Ciao`],
    expected: [['2026-04-02 13:00:00', 'Mario Rossi', 'Ciao']],
  },
  {
    name: 'Android German, dots in the date',
    text: [`02.04.26, 13:00 - Max Mustermann: Hallo`],
    expected: [['2026-04-02 13:00:00', 'Max Mustermann', 'Hallo']],
  },
  {
    name: 'iOS German',
    text: [`[02.04.26, 13:00:15] Max: Hallo`],
    expected: [['2026-04-02 13:00:15', 'Max', 'Hallo']],
  },
  {
    name: 'Android Spanish, no comma',
    text: [`2/4/26 13:00 - Ana: Hola`],
    expected: [['2026-04-02 13:00:00', 'Ana', 'Hola']],
  },
  {
    name: 'Android Latin American Spanish, «p. m.»',
    text: [`2/4/26 1:00 p.${NBSP}m. - Ana: Hola`],
    expected: [['2026-04-02 13:00:00', 'Ana', 'Hola']],
  },
  {
    name: 'Android Dutch, hyphens in the date',
    text: [`02-04-2026 13:00 - Jan: Hoi`],
    expected: [['2026-04-02 13:00:00', 'Jan', 'Hoi']],
  },
  {
    name: 'Android Swedish, ISO date',
    text: [`2026-04-02 13:00 - Erik: Hej`],
    expected: [['2026-04-02 13:00:00', 'Erik', 'Hej']],
  },
  {
    name: 'Android Finnish, «klo» and a dotted time',
    text: [`2.4.2026 klo 13.00 - Ville: Moi`],
    expected: [['2026-04-02 13:00:00', 'Ville', 'Moi']],
  },
  {
    name: 'Android Indian English, lowercase «pm»',
    text: [`02/04/2026, 1:00 pm - Raj: Hello`],
    expected: [['2026-04-02 13:00:00', 'Raj', 'Hello']],
  },
  {
    name: 'Android Brazilian Portuguese',
    text: [`02/04/2026 13:00 - João: Oi`],
    expected: [['2026-04-02 13:00:00', 'João', 'Oi']],
  },
  {
    name: 'Android Arabic, Arabic-Indic digits and «م»',
    text: [`${RLM}٢/٤/٢٠٢٦ ١:٠٠ م - أحمد: مرحبا`],
    expected: [['2026-04-02 13:00:00', 'أحمد', 'مرحبا']],
  },
  {
    name: 'Android Chinese, 下午 before the time',
    text: [`2026/4/2 下午1:00 - 小明: 你好`],
    expected: [['2026-04-02 13:00:00', '小明', '你好']],
  },
  {
    name: 'Android Korean, «오후» and dots with spaces',
    text: [`2026. 4. 2. 오후 1:00 - 민수: 안녕`],
    expected: [['2026-04-02 13:00:00', '민수', '안녕']],
  },
  {
    name: 'Multi-line message',
    text: [
      `[02/04/26, 13:00:15] Mario: prima riga`,
      `seconda riga`,
      `terza riga`,
      `[02/04/26, 13:00:20] Anna: ok`,
    ],
    expected: [['2026-04-02 13:00:15', 'Mario', 'prima riga\nseconda riga\nterza riga'], ['2026-04-02 13:00:20', 'Anna', 'ok']],
  },
  {
    name: 'All dates ambiguous: chronological order reveals a US export',
    text: [
      `[1/5/26, 9:00:00 AM] John: uno`,
      `[2/3/26, 9:00:00 AM] John: due`,
      `[3/1/26, 9:00:00 AM] John: tre`,
      `[4/8/26, 9:00:00 AM] John: quattro`,
    ],
    expectedOrder: 'mdy',
    expected: [
      ['2026-01-05 09:00:00', 'John', 'uno'], ['2026-02-03 09:00:00', 'John', 'due'],
      ['2026-03-01 09:00:00', 'John', 'tre'], ['2026-04-08 09:00:00', 'John', 'quattro'],
    ],
  },
  {
    name: 'All dates ambiguous: chronological order confirms a European export',
    text: [
      `[5/1/26, 09:00:00] Anna: uno`,
      `[3/2/26, 09:00:00] Anna: due`,
      `[1/3/26, 09:00:00] Anna: tre`,
      `[8/4/26, 09:00:00] Anna: quattro`,
    ],
    expectedOrder: 'dmy',
    expected: [
      ['2026-01-05 09:00:00', 'Anna', 'uno'], ['2026-02-03 09:00:00', 'Anna', 'due'],
      ['2026-03-01 09:00:00', 'Anna', 'tre'], ['2026-04-08 09:00:00', 'Anna', 'quattro'],
    ],
  },
];

/* ---------------------- attachment and status cases ----------------------- */

const MEDIA_CASES = [
  {
    name: 'iOS attachment (file present in the archive)',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}<allegato: 00000005-AUDIO-2026-04-02.opus>`],
    files: ['00000005-audio-2026-04-02.opus'],
    check: (m) => m.files && m.files.length === 1 && m.body === '',
  },
  {
    name: 'iOS attachment in English',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}<attached: 00000005-PHOTO-2026-04-02.jpg>`],
    files: ['00000005-photo-2026-04-02.jpg'],
    check: (m) => m.files && m.files.length === 1,
  },
  {
    name: 'Android attachment with a caption',
    text: [`02/04/2026, 13:03 - Mario: IMG-20260402-WA0001.jpg (file allegato)`, `che bella foto`],
    files: ['img-20260402-wa0001.jpg'],
    check: (m) => m.files && m.files.length === 1 && m.body === 'che bella foto',
  },
  {
    name: 'Android attachment in English',
    text: [`02/04/2026, 13:03 - Mario: VID-20260402-WA0002.mp4 (file attached)`],
    files: ['vid-20260402-wa0002.mp4'],
    check: (m) => m.files && m.files.length === 1,
  },
  {
    name: 'Attachment mentioned but missing from the archive',
    text: [`02/04/2026, 13:03 - Mario: IMG-20260402-WA0009.jpg (file allegato)`],
    files: [],
    check: (m) => !m.files && m.omitted && m.missingName === 'IMG-20260402-WA0009.jpg',
  },
  {
    name: 'Media not exported (localized text)',
    text: [`02/04/2026, 13:03 - Mario: ${LRM}immagine omessa`],
    files: [],
    check: (m) => m.omitted && m.omittedKind === 'image',
  },
  {
    name: 'Media not exported, in English',
    text: [`02/04/2026, 13:03 - Mario: <Media omitted>`],
    files: [],
    check: (m) => m.omitted,
  },
  {
    name: 'Deleted message',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}Questo messaggio è stato eliminato.`],
    files: [],
    check: (m) => m.deleted,
  },
  {
    name: 'Edited message',
    text: [`[02/04/26, 13:03:45] Mario: testo finale ${LRM}<Questo messaggio è stato modificato>`],
    files: [],
    check: (m) => m.edited && m.body === 'testo finale',
  },
  {
    name: 'Shared location',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}Posizione: https://maps.google.com/?q=37.813885,15.254655`],
    files: [],
    check: (m) => m.loc && m.loc.lat === '37.813885',
  },
  {
    name: 'Encryption notice recognized as a system message',
    text: [`[02/04/26, 13:00:15] Mario: ${LRM}I messaggi e le chiamate sono crittografati end-to-end.`],
    files: [],
    check: (m) => m.sys,
  },
  {
    name: 'Missed call',
    text: [`[02/04/26, 13:00:15] Mario: ${LRM}Chiamata vocale persa. ${LRM}Tocca per richiamare`],
    files: [],
    check: (m) => m.call === 'voice' && m.callMissed,
  },
  {
    name: 'Group event with no sender',
    text: [
      `02/04/2026, 13:00 - Mario ha aggiunto Anna`,
      `02/04/2026, 13:01 - Mario: ciao a tutti`,
      `02/04/2026, 13:02 - Anna: ciao!`,
      `02/04/2026, 13:03 - Luca: presente`,
    ],
    files: [],
    check: (m, all) => all[0].sys && all.filter(x => !x.sys).length === 3,
  },
];

/* ---------------------------------------------------------------------- run */

let passed = 0, failed = 0;
const fail = (name, detail) => { failed++; console.log(`  ✗ ${name}\n      ${detail}`); };

for (const c of CASES) {
  const r = await Parser.parse(c.text.join('\r\n'), new Map(), {});
  if (r.messages.length !== c.expected.length) {
    fail(c.name, `${r.messages.length} messages instead of ${c.expected.length}`);
    continue;
  }
  if (c.expectedOrder && r.order !== c.expectedOrder) {
    fail(c.name, `detected order "${r.order}" instead of "${c.expectedOrder}"`);
    continue;
  }
  let error = null;
  r.messages.forEach((m, i) => {
    const [date, sender, body] = c.expected[i];
    if (stamp(m.t) !== date) error = `message ${i + 1}: date ${stamp(m.t)} instead of ${date}`;
    else if (m.sender !== sender) error = `message ${i + 1}: sender "${m.sender}" instead of "${sender}"`;
    else if (m.body !== body) error = `message ${i + 1}: body ${JSON.stringify(m.body)} instead of ${JSON.stringify(body)}`;
  });
  if (error) fail(c.name, error);
  else { passed++; console.log(`  ✓ ${c.name}`); }
}

for (const c of MEDIA_CASES) {
  const fileMap = new Map(c.files.map(n => [n, { base: n, name: n, size: 1000 }]));
  const r = await Parser.parse(c.text.join('\r\n'), fileMap, {});
  const m = r.messages[0];
  if (!m) { fail(c.name, 'no message recognized'); continue; }
  if (!c.check(m, r.messages)) {
    fail(c.name, JSON.stringify({ sys: m.sys, body: m.body, files: m.files && m.files.map(f => f.base),
      omitted: m.omitted, missingName: m.missingName, deleted: m.deleted, edited: m.edited, call: m.call }));
  } else { passed++; console.log(`  ✓ ${c.name}`); }
}


/* ---------------- WhatsApp-generated messages, by language ---------------- */

// Phrases WhatsApp writes on its own. On iPhone they arrive prefixed with the
// invisible character U+200E, which is what lets us spot them in any language.
const DELETED = [
  ['English',      'This message was deleted'],
  ['Spanish',      'Se eliminó este mensaje'],
  ['Portuguese',   'Esta mensagem foi apagada'],
  ['French',       'Ce message a été supprimé'],
  ['German',       'Diese Nachricht wurde gelöscht'],
  ['Dutch',        'Dit bericht is verwijderd'],
  ['Turkish',      'Bu mesaj silindi'],
  ['Russian',      'Это сообщение было удалено'],
  ['Indonesian',   'Pesan ini telah dihapus'],
  ['Arabic',       'تم حذف هذه الرسالة'],
  ['Hindi',        'यह मैसेज डिलीट कर दिया गया'],
  ['Japanese',     'このメッセージは削除されました'],
  ['Korean',       '이 메시지는 삭제되었습니다'],
  ['Chinese',      '此消息已删除'],
];

const OMITTED = [
  ['English',      '<Media omitted>',              'media'],
  ['English iOS',  'image omitted',                'image'],
  ['English iOS',  'video omitted',                'video'],
  ['English iOS',  'audio omitted',                'audio'],
  ['English iOS',  'sticker omitted',              'sticker'],
  ['Spanish',      '<Multimedia omitido>',         'media'],
  ['Portuguese',   '<Arquivo de mídia oculto>',    'media'],
  ['French',       '<Médias omis>',                'media'],
  ['German',       '<Medien ausgeschlossen>',      'media'],
  ['Dutch',        '<Media weggelaten>',           'media'],
  ['Turkish',      '<Medya dahil edilmedi>',       'media'],
  ['Indonesian',   '<Media tidak disertakan>',     'media'],
  ['Russian',      '<Медиафайлы отсутствуют>',     'media'],
  ['Italian',      'immagine omessa',              'image'],
  ['German iOS',   'Bild weggelassen',             'image'],
];

for (const [lang, phrase] of DELETED) {
  const r = await Parser.parse(`[02/04/26, 13:03:45] Mario: ${LRM}${phrase}`, new Map(), {});
  if (r.messages[0] && r.messages[0].deleted) { passed++; console.log(`  ✓ Deleted (${lang})`); }
  else fail(`Deleted (${lang})`, JSON.stringify(r.messages[0]));
}

for (const [lang, phrase, kind] of OMITTED) {
  const r = await Parser.parse(`[02/04/26, 13:03:45] Mario: ${LRM}${phrase}`, new Map(), {});
  const m = r.messages[0];
  if (m && m.omitted && m.omittedKind === kind) { passed++; console.log(`  ✓ Media not exported, ${lang}: «${phrase}»`); }
  else fail(`Media not exported (${lang}: ${phrase})`, JSON.stringify(m));
}

/* ---------------------- structure without vocabulary ---------------------- */

const STRUCTURE = [
  {
    // Without the name of a media type this stays a chat notice: better a
    // centered line than claiming there is a media file that may not exist.
    name: 'Language not on the list: still recognized as generated content',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}ⵉⵎⵢⴰ ⵜⵜⵜⵜ ⵣⵣⵣ`],
    check: (m) => m.sys === true && !m.body.startsWith('ⵉ') === false,
  },
  {
    name: 'Android: deletion recognized because the phrase repeats',
    text: [
      `02/04/2026, 13:03 - Mario: This message was deleted`,
      `02/04/2026, 13:04 - Anna: ok`,
      `02/04/2026, 13:05 - Mario: This message was deleted`,
    ],
    check: (m, all) => all[0].deleted && all[2].deleted && !all[1].deleted,
  },
  {
    name: 'A real sentence about deleting is not mistaken for a placeholder',
    text: [`02/04/2026, 13:03 - Mario: Ho eliminato la foto dal telefono, scusa`],
    check: (m) => !m.deleted && !m.omitted && m.body.startsWith('Ho eliminato'),
  },
  {
    name: 'A message that names a file is not mistaken for a placeholder',
    text: [`02/04/2026, 13:03 - Mario: mandami il curriculum.pdf quando puoi`],
    check: (m) => !m.omitted && !m.files && m.body.includes('curriculum.pdf'),
  },
  {
    name: 'Poll with options and votes',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}SONDAGGIO: Che film vediamo?`,
           `OPZIONE: Il primo (9 voti)`, `OPZIONE: Il secondo (2 voti)`],
    check: (m) => m.poll && m.poll.question === 'Che film vediamo?' &&
                  m.poll.options.length === 2 && m.poll.options[0].votes === 9,
  },
  {
    name: 'Poll in English',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}POLL: Where do we meet?`,
           `OPTION: At the cinema (4 votes)`, `OPTION: At my place (1 vote)`],
    check: (m) => m.poll && m.poll.options.length === 2,
  },
  {
    name: 'A list with a repeated prefix is not a poll',
    text: [`02/04/2026, 13:03 - Mario: Spesa: pane`, `Spesa: latte (2 pezzi)`, `Spesa: uova (6 pezzi)`],
    check: (m) => !m.poll && m.body.startsWith('Spesa: pane'),
  },
  {
    name: 'Line with no content: dropped instead of becoming an empty bubble',
    text: [`[04/08/26, 21:19] Marco Rossi:`,
           `[04/08/26, 21:20] Marco Rossi: ciao`],
    check: (m, all) => all.length === 1 && all[0].body === 'ciao' && !all.some(x => x.sys),
  },
  {
    name: 'Body made only of invisible characters: dropped',
    text: [`[04/08/26, 21:19] Marco Rossi: ${LRM}`,
           `[04/08/26, 21:20] Marco Rossi: ciao`],
    check: (m, all) => all.length === 1 && all[0].body === 'ciao',
  },
  {
    name: 'Missed call in English',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}Missed voice call`],
    check: (m) => m.call === 'voice' && m.callMissed,
  },
  {
    name: 'Video call in Spanish',
    text: [`[02/04/26, 13:03:45] Mario: ${LRM}Videollamada. 12 minutos`],
    check: (m) => m.call === 'video',
  },
  {
    name: 'Encryption notice in German',
    text: [`[02/04/26, 13:00:15] Mario: ${LRM}Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt.`],
    check: (m) => m.sys,
  },
  {
    name: 'Edited, in English',
    text: [`[02/04/26, 13:03:45] Mario: final text ${LRM}<This message was edited>`],
    check: (m) => m.edited && m.body === 'final text',
  },
];

for (const c of STRUCTURE) {
  const r = await Parser.parse(c.text.join('\r\n'), new Map(), {});
  const m = r.messages[0];
  if (m && c.check(m, r.messages)) { passed++; console.log(`  ✓ ${c.name}`); }
  else fail(c.name, JSON.stringify(m));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
