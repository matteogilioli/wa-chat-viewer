# WA Chat Viewer

Read an exported WhatsApp chat **as if you were still inside the app**: green and white bubbles,
voice notes with a waveform, photos, videos, documents, stickers, polls, day separators, search and
statistics.

Open the exported **`.zip`** directly — nothing to unpack, nothing to install, nothing to upload.
Everything happens inside the browser, offline.

<!-- add a screenshot here once you have one you like -->

## Quick start

1. Open `dist/wa-chat-viewer.html` — a single file, works offline, just double-click it.
2. Drop the chat `.zip` on it, or tap to pick one.
3. That's it.

You can also open `index.html` from the project folder: same app, with the sources unbundled.
Rebuild the single file with:

```sh
node build.js
```

### Exporting a chat from WhatsApp

Open the conversation → **⋮** (Android) or the contact name (iPhone) → **Export chat** →
**Attach media**. You get a `.zip` containing `_chat.txt` and the attachments. The same steps are
shown on the app's welcome screen, in your language.

> On long chats WhatsApp only attaches the most recent media. The rest stays in the export as
> "image omitted" and shows up here as a placeholder.

### On a phone

The file works on phones too, but mobile browsers are reluctant to open local files. Two easy ways:

- **iPhone/iPad**: put `wa-chat-viewer.html` and the zip in the **Files** app (or iCloud Drive) and
  tap the HTML: it opens in Safari and you can pick the zip from there.
- **Any phone**: publish the folder on GitHub Pages (or any static host) and open the address. Even
  then the zip **is never uploaded**: it stays on the phone and is only read by the browser.

## What it renders

| Content | How |
|---|---|
| Text | WhatsApp-style bubbles, with `*bold*`, `_italic_`, `~strikethrough~`, ```` ```code``` ```` and clickable links |
| Mentions | `@Name` highlighted in blue, matched against the participants |
| Photos and stickers | Preview in the bubble; photos open full screen with previous/next |
| Several photos at once | Grouped into an album grid (2, 3, 4 or 2×2 with **+N**), like the app |
| Videos | First frame as a thumbnail, with duration and a play button |
| GIFs and animated stickers | Play by themselves, looping and muted |
| Voice notes | Player with waveform, duration, 1×/1.5×/2× speed, one track at a time |
| Polls | Question, options with proportional bars and vote counts |
| Documents | Card with name, type and size; PDFs open in a new tab |
| Contacts (`.vcf`) | Card with the name and number read from the file |
| Location | Card with coordinates and a link to Google Maps |
| Calls, deleted messages, media left out | Dedicated placeholders |
| System notices | Centered, with the encryption notice in WhatsApp's amber |

Plus: full-text search with a result list, jump to a date, conversation statistics, light/dark/auto
theme, and a "that's you" picker so your own messages sit on the right.

## Interface languages

The interface ships in **12 languages** — Italian, English, Spanish, Portuguese, French, German,
Dutch, Turkish, Russian, Indonesian, Hindi and Arabic — picked from the browser, changeable from the
welcome screen or the settings, and remembered. Arabic switches the whole layout to right-to-left.

## Supported export formats

WhatsApp writes `_chat.txt` differently depending on the phone and the language. These are covered,
and checked by automated tests:

| Variant | Example line |
|---|---|
| iOS, 24-hour | `[02/04/26, 13:00:15] Mario: ciao` |
| iOS, 12-hour (including iOS 17's narrow space) | `[4/17/26, 1:00:15 PM] John: hi` |
| Android, with a dash | `02/04/2026, 13:00 - Mario: ciao` |
| Dots instead of slashes (German) | `02.04.26, 13:00 - Max: hallo` |
| No comma (Spanish) | `2/4/26 13:00 - Ana: hola` |
| "p. m." / lowercase "pm" | `2/4/26 1:00 p. m. - Ana: hola` |
| Dashes in the date (Dutch) | `02-04-2026 13:00 - Jan: hoi` |
| ISO dates (Swedish) | `2026-04-02 13:00 - Erik: hej` |
| A word between date and time, dotted time (Finnish) | `2.4.2026 klo 13.00 - Ville: moi` |
| Arabic-Indic digits and "ص/م" | `٢/٤/٢٠٢٦ ١:٠٠ م - أحمد: مرحبا` |
| Marker before the time (Chinese, Japanese, Korean) | `2026/4/2 下午1:00 - 小明: 你好` |

**Day/month or month/day?** A value above 12 in either position settles it. When every date is
ambiguous, the fact that messages are in chronological order does: both readings are tried and the
one that never sends the calendar backwards wins. The manual override stays in the settings.

**Attachments** are not recognized from the label — that is translated ("attached", "allegato",
"angehängt"…) — but by looking for the file name inside the archive, so it works in any language. If
an attachment is referenced but the file is missing, a placeholder shows its name.

The lines WhatsApp writes by itself (deleted messages, media left out, calls, notices) are
recognized **structurally first**: iOS prefixes them with an invisible character, Android wraps them
in angle brackets, and the "edited" marker always trails in angle brackets. The word list only picks
the right icon, so an unlisted language still renders a proper placeholder instead of raw text.

## Tests and demo archive

No dependencies, no test runner:

```sh
node test/formats.test.mjs      # 74 cases covering the parser
node test/make-fixture.mjs      # builds fake archives to open
```

The cases cover the format variants above, multi-line messages, iOS and Android attachments, media
left out, deleted and edited messages, polls, locations, calls and group events — in 17 languages —
plus the guards that keep ordinary messages from being mistaken for placeholders.

`make-fixture.mjs` builds archives shaped exactly like real exports (`_chat.txt`, voice notes,
photos, video, PDF, contact) but with invented content and media generated on the spot, so the
interface can be exercised without opening a real conversation:

```sh
node test/make-fixture.mjs                 # a 1:1 chat and a group chat
node test/make-fixture.mjs --photos 300    # photo-heavy, for scrolling
node test/make-fixture.mjs --big 200000    # 200,000 messages, for stress
```

## How it works

Zero dependencies: no `npm install`, no external library, no network request.

```
index.html          page structure
css/style.css       all the styling, light and dark themes
js/i18n.js          interface strings in 12 languages
js/archive.js       hand-written ZIP reader (native DecompressionStream) + folder reader
js/markers.js       recognizes the lines WhatsApp writes by itself
js/parser.js        _chat.txt into structured messages
js/format.js        dates, rich text, mentions, avatars, emoji
js/media.js         file types, on-demand extraction, image headers, LRU cache
js/virtual.js       virtualized list with a Fenwick tree
js/render.js        bubble construction
js/panels.js        search, statistics, settings, full-screen viewer
js/app.js           wiring
build.js            bundles everything into dist/wa-chat-viewer.html
```

A few choices that make the difference against similar viewers:

- **The zip is never unpacked into memory.** Only the central directory is read; a media file is
  extracted when its bubble scrolls into view and released when it leaves. Uncompressed entries —
  which is what WhatsApp stores photos and videos as — are handed to the browser as a slice of the
  original file, with no copy at all.
- **Photo dimensions are read from the file headers before rendering.** That reserves the exact
  space in the bubble, so a chat full of photos does not reflow as they load.
- **Only the visible messages exist in the DOM.** Real heights live in a Fenwick tree, so "jump to
  12 March" costs `O(log n)` even with 200,000 messages.
- **Row heights are calibrated at runtime**, by measuring invisible samples with the real CSS, so
  the estimate is exact and the list never settles under your finger.
- **The scroll position is never rewritten while you scroll.** Fighting the browser's inertia is
  what makes most virtualized lists feel stiff on Safari; height corrections above the viewport wait
  until you lift your finger, and the list paints ahead in proportion to your speed, because WebKit
  delivers scroll events late during inertial scrolling.

## Known limits

- **`.opus` voice notes** play on Chrome, Firefox and Edge. Some versions of Safari cannot, and the
  bubble then offers the file for download.
- **`.heic` photos** (iPhone) display on Safari; other browsers show a placeholder with a download
  link, because they do not support the format.
- The export carries no **quoted replies**, no reactions and no real read state: the blue double
  ticks are decorative.
- When a message only says "image omitted", the export gives no way to tell a view-once photo from
  one that was never downloaded or was simply left out — the placeholder explains all three.
- Needs a recent browser (Chrome/Edge 80+, Firefox 113+, Safari 16.4+) for native ZIP
  decompression. With older ones, unpack the zip yourself and use "I already have an extracted
  folder".

## Privacy

There is no server. The archive is read by the browser with local APIs (`File`, `Blob`,
`DecompressionStream`) and media are shown through temporary in-memory URLs. No byte of the
conversation ever leaves the device, not even when the page is opened from a web address.

## License

MIT.
