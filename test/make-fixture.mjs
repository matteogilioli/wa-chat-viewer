/* ==========================================================================
   make-fixture.mjs — builds a test archive shaped exactly like the ones
   WhatsApp exports, but with made-up content.

       node test/make-fixture.mjs [folder]

   Handy for trying out the interface (and for having something to demo)
   without using a real conversation. It produces two archives in test/fixture:
   a one-to-one chat (_chat.txt, voice notes, photos, a PDF and a contact) and
   a group chat (photos, an album, a sticker, a poll and, when ffmpeg is
   installed, a video and a GIF).
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const outDir = (args[0] && !args[0].startsWith('--')) ? args[0]
             : path.dirname(fileURLToPath(import.meta.url)) + '/fixture';

/* ------------------------------------------------------------------ media */

/** Mono 8 kHz WAV: a note that fades out, so the player shows a real duration. */
function wav(seconds, freq) {
  const rate = 8000, n = Math.floor(rate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 6) * Math.max(0, 1 - t / seconds);
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * t) * 9000 * env), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/** PNG with a banded pattern: no dependencies, just zlib. */
function png(w, h, hue) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const v = (Math.sin(x / 18) + Math.cos(y / 14)) * 0.25 + 0.5;
      raw[p++] = Math.round(255 * v * (hue === 0 ? 1 : 0.35));
      raw[p++] = Math.round(255 * v * (hue === 1 ? 1 : 0.55));
      raw[p++] = Math.round(255 * v * (hue === 2 ? 1 : 0.75));
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bit, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pdf(title) {
  const text = `BT /F1 22 Tf 60 720 Td (${title}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
         off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/* ------------------------------------------------------- the conversation */

/** Short test clip, when ffmpeg is around: used to check video thumbnails. */
function mp4(file, seconds, tone) {
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=480x270:rate=12:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${300 + tone * 90}:duration=${seconds}`,
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', file]);
    return true;
  } catch (_) {
    return false;                      // no ffmpeg: the fixture simply has no video
  }
}

const ME = 'Anna Rossi';
const HER = 'Giulia Esposito';
const LRM = '‎';

const script = [
  ['02/04/26', '09:12:03', HER, `${LRM}I messaggi e le chiamate sono crittografati end-to-end. Solo le persone in questa chat possono leggerne, ascoltarne o condividerne il contenuto.`],
  ['02/04/26', '09:12:03', HER, `${LRM}${HER} è tra i tuoi contatti.`],
  ['02/04/26', '09:12:40', HER, 'Buongiorno! Allora, per sabato confermi?'],
  ['02/04/26', '09:13:02', ME, 'Confermo 👍'],
  ['02/04/26', '09:13:20', ME, 'Ti mando due foto del posto così ti fai un’idea'],
  ['02/04/26', '09:13:44', ME, `${LRM}<allegato: 00000001-PHOTO-2026-04-02-09-13-44.png>`],
  ['02/04/26', '09:13:52', ME, `${LRM}<allegato: 00000002-PHOTO-2026-04-02-09-13-52.png>\nQuesta è la vista dalla terrazza`],
  ['02/04/26', '09:15:10', HER, 'Bellissimo 😍😍'],
  ['02/04/26', '09:15:31', HER, `${LRM}<allegato: 00000003-AUDIO-2026-04-02-09-15-31.wav>`],
  ['02/04/26', '09:18:02', ME, 'Ahah hai ragione, *portiamo* anche il _telo_ allora'],
  ['02/04/26', '09:18:30', ME, 'Lista:\n- telo\n- crema\n- ombrellone'],
  ['02/04/26', '09:19:05', HER, `${LRM}<allegato: 00000004-AUDIO-2026-04-02-09-19-05.wav>`],
  ['02/04/26', '09:22:00', HER, `${LRM}immagine omessa`],
  ['02/04/26', '09:24:11', ME, `${LRM}Posizione: https://maps.google.com/?q=44.647128,10.925227`],
  ['02/04/26', '09:26:40', HER, 'Perfetto, ci vediamo lì'],
  ['03/04/26', '18:02:15', ME, `${LRM}<allegato: 00000005-Programma_gita.pdf>\nProgramma_gita.pdf • 1 pagina`],
  ['03/04/26', '18:04:00', HER, `${LRM}<allegato: 00000006-Giulia_Esposito.vcf>`],
  ['03/04/26', '18:05:12', HER, 'Ti passo il contatto di mia sorella, viene anche lei'],
  ['03/04/26', '18:06:00', ME, '😂'],
  ['03/04/26', '18:06:31', ME, 'Va benissimo, siamo in cinque allora ✌️'],
  ['03/04/26', '18:40:02', HER, `${LRM}Chiamata vocale persa. ${LRM}Tocca per richiamare`],
  ['04/04/26', '11:00:00', HER, `${LRM}Questo messaggio è stato eliminato.`],
  ['04/04/26', '11:02:44', ME, `Ho prenotato per le 9 ${LRM}<Questo messaggio è stato modificato>`],
  ['04/04/26', '11:03:10', HER, 'Grazie mille davvero ❤️'],
];

// Group chat: WhatsApp attributes notices to the GROUP NAME and your own
// actions to «Tu». They are here to check that neither ends up among the
// selectable participants.
const GROUP = 'Cinema Crew';
const A = 'Luca Ferrari', B = 'Sara Conti';

const groupScript = [
  ['05/04/26', '10:00:00', GROUP, `${LRM}I messaggi e le chiamate sono crittografati end-to-end.`],
  ['05/04/26', '10:00:00', 'Tu', `${LRM}Hai creato il gruppo «${GROUP}»`],
  ['05/04/26', '10:00:05', 'Tu', `${LRM}Hai aggiunto ${A}`],
  ['05/04/26', '10:00:20', 'Tu', `${LRM}Hai cambiato l’icona del gruppo`],
  ['05/04/26', '10:00:30', GROUP, `${LRM}L’oggetto è stato cambiato`],
  ['05/04/26', '10:00:40', 'Tu', `${LRM}Hai attivato i messaggi effimeri`],
  ['05/04/26', '10:01:10', A, 'Ciao a tutti! Che film vediamo?'],
  ['05/04/26', '10:02:00', B, 'Io voto per il primo spettacolo'],
  ['05/04/26', '10:02:40', ME, 'Per me va bene, prendo i biglietti'],
  ['05/04/26', '10:03:10', A, `${LRM}<allegato: 00000007-PHOTO-2026-04-05-10-03-10.png>\nGuardate la locandina`],
  ['05/04/26', '10:04:00', B, 'Bellissima 😍'],
  ['05/04/26', '10:05:30', ME, `${LRM}<allegato: 00000008-AUDIO-2026-04-05-10-05-30.wav>`],
  ['05/04/26', '10:05:50', B, `${LRM}SONDAGGIO: Che spettacolo prendiamo?\nOPZIONE: Quello delle 18 (4 voti)\nOPZIONE: Quello delle 21 (7 voti)\nOPZIONE: Mi va bene tutto (1 voto)`],
  ['05/04/26', '10:06:10', ME, '😂😂😂'],
  ['05/04/26', '10:06:20', B, '❤️'],
  ['05/04/26', '10:06:40', A, `${LRM}<allegato: 00000009-STICKER-2026-04-05-10-06-40.png>`],
  ['05/04/26', '10:06:50', B, `${LRM}<allegato: 00000010-PHOTO-2026-04-05-10-06-50.png>`],
  ['05/04/26', '10:06:52', B, `${LRM}<allegato: 00000011-PHOTO-2026-04-05-10-06-52.png>`],
  ['05/04/26', '10:06:54', B, `${LRM}<allegato: 00000012-PHOTO-2026-04-05-10-06-54.png>`],
  ['05/04/26', '10:06:56', B, `${LRM}<allegato: 00000013-PHOTO-2026-04-05-10-06-56.png>`],
  ['05/04/26', '10:06:58', B, `${LRM}<allegato: 00000014-PHOTO-2026-04-05-10-06-58.png>\nEcco tutte le foto della serata`],
  ['05/04/26', '10:06:57', A, `${LRM}<allegato: 00000015-VIDEO-2026-04-05-10-06-57.mp4>`],
  ['05/04/26', '10:06:58', B, 'ahah bellissimo'],
  ['05/04/26', '10:06:59', A, `${LRM}<allegato: 00000016-GIF-2026-04-05-10-06-58.mp4>`],
  ['05/04/26', '10:06:59', A, '@' + ME + ' porti tu il proiettore?'],
  ['05/04/26', '10:07:00', A, 'Perfetto, ci vediamo lì'],
  ['05/04/26', '10:08:00', B, 'A dopo!'],
];

const line = ([d, t, who, text]) => `[${d}, ${t}] ${who}: ${text}`;
const chat = script.map(line).join('\r\n') + '\r\n';
const groupChat = groupScript.map(line).join('\r\n') + '\r\n';

/* ---------------------------------------------------------------- writing */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-fixture-'));
const write = (name, buf) => fs.writeFileSync(path.join(tmp, name), buf);

write('_chat.txt', Buffer.from(chat, 'utf8'));
write('00000001-PHOTO-2026-04-02-09-13-44.png', png(640, 420, 0));
write('00000002-PHOTO-2026-04-02-09-13-52.png', png(480, 640, 1));
write('00000003-AUDIO-2026-04-02-09-15-31.wav', wav(3.4, 320));
write('00000004-AUDIO-2026-04-02-09-19-05.wav', wav(7.2, 220));
write('00000005-Programma_gita.pdf', pdf('Programma della gita'));
write('00000006-Giulia_Esposito.vcf', Buffer.from(
  'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Chiara Esposito\r\nTEL;type=CELL:+39 333 1234567\r\nEND:VCARD\r\n', 'utf8'));

fs.mkdirSync(outDir, { recursive: true });

const pack = (zipName, files) => {
  const zip = path.join(outDir, zipName);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-X', '-j', zip, ...files.map(f => path.join(tmp, f))]);
  console.log('Created ' + zip + '  (' + (fs.statSync(zip).size / 1024).toFixed(0) + ' kB)');
};

pack('Chat WhatsApp con Giulia Esposito.zip', [
  '_chat.txt',
  '00000001-PHOTO-2026-04-02-09-13-44.png', '00000002-PHOTO-2026-04-02-09-13-52.png',
  '00000003-AUDIO-2026-04-02-09-15-31.wav', '00000004-AUDIO-2026-04-02-09-19-05.wav',
  '00000005-Programma_gita.pdf', '00000006-Giulia_Esposito.vcf',
]);

// rewrite the chat file for the group
fs.writeFileSync(path.join(tmp, '_chat.txt'), Buffer.from(groupChat, 'utf8'));
write('00000007-PHOTO-2026-04-05-10-03-10.png', png(560, 760, 2));
write('00000008-AUDIO-2026-04-05-10-05-30.wav', wav(4.6, 260));
write('00000009-STICKER-2026-04-05-10-06-40.png', png(220, 220, 1));
for (let k = 0; k < 5; k++) {
  write(`0000001${k}-PHOTO-2026-04-05-10-06-5${k * 2}.png`, png(300 + k * 40, 240 + k * 30, k % 3));
}
const hasVideo = mp4(path.join(tmp, '00000015-VIDEO-2026-04-05-10-06-57.mp4'), 12, 1) &&
                mp4(path.join(tmp, '00000016-GIF-2026-04-05-10-06-58.mp4'), 3, 2);
pack('Chat WhatsApp con Cinema Crew.zip', [
  '_chat.txt', '00000007-PHOTO-2026-04-05-10-03-10.png',
  '00000008-AUDIO-2026-04-05-10-05-30.wav', '00000009-STICKER-2026-04-05-10-06-40.png',
  ...Array.from({ length: 5 }, (_, k) => `0000001${k}-PHOTO-2026-04-05-10-06-5${k * 2}.png`),
  ...(hasVideo ? ['00000015-VIDEO-2026-04-05-10-06-57.mp4', '00000016-GIF-2026-04-05-10-06-58.mp4'] : []),
]);

/* ---------------------------------------------------- photo-heavy archive */
// `node test/make-fixture.mjs --photos 300` builds a chat where nearly every
// message is a photo, in assorted aspect ratios: it measures scrolling
// performance in the worst case for the height estimator.
const photosArg = args.indexOf('--photos');
if (photosArg >= 0) {
  const n = Number(args[photosArg + 1] || 300);
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-photos-'));
  const lines = [];
  const start = new Date(2024, 5, 1, 9, 0, 0).getTime();
  const shapes = [[640, 480], [480, 640], [800, 450], [512, 512], [360, 640]];
  for (let k = 0; k < n; k++) {
    const d = new Date(start + k * 300000);
    const p = (v) => String(v).padStart(2, '0');
    const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
    const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const name = `${String(k).padStart(8, '0')}-PHOTO-2024-06-01.png`;
    const [w, h] = shapes[k % shapes.length];
    fs.writeFileSync(path.join(tmp3, name), png(w, h, k % 3));
    lines.push(`[${date}, ${time}] ${k % 2 ? ME : HER}: ${LRM}<allegato: ${name}>`);
    if (k % 4 === 0) lines.push(`[${date}, ${time}] ${k % 2 ? ME : HER}: che ne dici di questa?`);
  }
  fs.writeFileSync(path.join(tmp3, '_chat.txt'), lines.join('\r\n') + '\r\n');
  const zip = path.join(outDir, 'Chat WhatsApp con Foto Test.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-X', '-j', '-0', zip, ...fs.readdirSync(tmp3).map(f => path.join(tmp3, f))]);
  fs.rmSync(tmp3, { recursive: true, force: true });
  console.log(`Created ${zip}  (${n} photos, ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
}

/* ------------------------------------------------------- enormous archive */
// `node test/make-fixture.mjs --big 200000` builds a conversation with the
// given number of messages: it measures timings on heavy chats.
const bigArg = args.indexOf('--big');
if (bigArg >= 0) {
  const n = Number(args[bigArg + 1] || 200000);
  const phrases = [
    'ok', 'ci sentiamo dopo', 'guarda che ti ho scritto ieri sera',
    'perfetto allora ci vediamo lì verso le otto e mezza', 'ahah 😂',
    'ti mando il documento appena arrivo a casa, ricordamelo',
    'niente, alla fine ho deciso di rimandare tutto a settimana prossima',
  ];
  const lines = [];
  const start = new Date(2020, 0, 1, 8, 0, 0).getTime();
  for (let k = 0; k < n; k++) {
    const d = new Date(start + k * 90000);
    const p = (v) => String(v).padStart(2, '0');
    const date = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
    const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    lines.push(`[${date}, ${time}] ${k % 2 ? ME : HER}: ${phrases[k % phrases.length]} #${k}`);
  }
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-big-'));
  fs.writeFileSync(path.join(tmp2, '_chat.txt'), lines.join('\r\n') + '\r\n');
  const zip = path.join(outDir, `Chat WhatsApp con Stress Test.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-X', '-j', zip, path.join(tmp2, '_chat.txt')]);
  fs.rmSync(tmp2, { recursive: true, force: true });
  console.log(`Created ${zip}  (${n.toLocaleString('en-US')} messages, ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
}

fs.rmSync(tmp, { recursive: true, force: true });
