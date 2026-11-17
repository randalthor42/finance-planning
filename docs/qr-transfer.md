# Moving plans with QR codes

Two devices side by side, no network, no account: one screen shows a loop of QR codes, the other reads them with its
camera. Settings › Storage › *Move with QR codes* (*Send* / *Receive*); *Receive with QR codes* is also on the welcome
screen of a new device.

## Sending (`qrSendModal`)

1. Choose *This plan* or *All plans* (all plans carry the deleted plans too, so a deletion travels).
2. A one-time **code** is made: 12 random characters without look-alikes (`randomText(CODE_CHARS, 12)` from
   `core/util.js`, each character equally likely), written `XXXX-XXXX-XXXX` by `transferCode`; about 60 bits.
   `logic/qrChunks.js` stays pure: the code and the transfer id are drawn by the window and passed in.
3. The plans become a backup encrypted with that code (`IO.backup(plans, code, extra, { zip: true })`: gzip, then
   AES-256-GCM with a PBKDF2 key; the encrypted backup format, marked `v: 2` because it is compressed). The code is
   **never inside the QR codes**, and it stays hidden (dots) until the person taps *Show the code*, once the other
   device has every code: a photo or film of the loop does not catch it. While the code is shown the loop stops
   (*Show the QR codes again* brings it back, the code hidden again, if the other device still needs some), so one
   picture never holds both. When the window closes the key made for the code is dropped (`IO.forget`).
4. The text is cut into frames (`logic/qrChunks.js makeFrames`, 500 characters each, at most `MAX_FRAMES` = 1000)
   shown in a loop, 4 a second (*Slow* 2, *Fast* 8), with "Code 3 of 12" under them. The screen is kept on (Wake
   Lock, where available; asked for again when the page comes back from the background).

A frame is one QR code's text: `RW1:<transfer id>:<index>:<total>:<crc32>:<data>`, the checksum taken over
`<transfer id>:<index>:<total>:<data>`, so a misread index or total is caught as well. Frames of earlier builds
(checksum of the data only) are not read: both ends of a transfer run the same version. A code that claims more than
`MAX_FRAMES` frames is not a Runway code.

The sample plan takes about 8 codes; a heavy 10-year plan several hundred (a note suggests Drive sync or a backup
file above 240).

## Receiving (`qrReceiveModal`)

1. The back camera (`getUserMedia`, `facingMode: environment`). Refused, missing or impossible (a page without
   camera access): a plain message says what to do.
2. Frames are read from the video: with the browser's `BarcodeDetector` where it reads QR codes (Chrome on Android, for
   example), otherwise with the bundled reader (jsQR). Any order, repeats ignored (`Receiver`). Progress:
   "Scanned 7 of 12". Once at most 5 codes are missing, or a whole loop (at the slowest speed) has gone by since the
   first code, the missing ones are named: "Waiting for codes 4, 9" (worked out only then, `Receiver.missing(limit)`).
3. Clear messages for a misread code (bad checksum: "it comes round again"), a code of **another transfer** (the
   sender started again: *Start over*), and a QR code that is not Runway's. *Start over* also starts the camera again
   when it could not be started (refused, then allowed).
4. When every frame is in, the camera stops and the code from the other screen is asked for (any case, with or
   without spaces or dashes). A wrong code is refused ("does not match"). Once opened, or when the window closes,
   any key made for a typed code is dropped (`IO.forget`).
5. The import preview shows, plan by plan, what merging would change (new plan, updated with counts, no changes,
   deleted). **Merge** uses the sync rules ([sync.md](sync.md#merge-rules-logicrecordmergejs-pure)); **Add as separate
   copies** adds the plans next to the existing ones. A backup of the data is kept before merging.

## The QR libraries, loaded only when used

The page itself has no QR code: the maker (`src/ui/qr/encode.js`, with the vendored qrcode-generator) and the reader
(`src/ui/qr/decode.js`, with the vendored jsQR) are bundled on their own by `build/qr.js` (esbuild, the bundler Vite
uses) and loaded by `src/ui/qrLoader.js` the first time a transfer needs them:

| How Runway is opened | Where the modules come from |
|---|---|
| served over http(s), or the installed app | `qr-encode.js` / `qr-decode.js` next to the page; the service worker keeps both at install, so they work offline |
| the file to hand out, from disk | embedded in `runway-money-planner.html` as `<script type="text/plain">`, imported from a `blob:` URL |
| `npm run dev` | the source modules |

So the page that opens every day carries none of their ~150 KB. The libraries and their licences are in
`src/vendor/` (see its README); they are copied unchanged and excluded from lint and formatting. esbuild drops the
libraries' own comments (`legalComments: 'none'`), so `build/qr.js` puts the licences back in every shipped copy (the
two files and the copies embedded in the file to hand out): the full MIT notice of qrcode-generator at the top of
`qr-encode.js`; the Apache-2.0 notice of jsQR at the top of `qr-decode.js` and the licence text
(`src/vendor/jsQR.LICENSE`, read when building) at its end. In the embedded copies every `</script` is written
`<\/script` (case kept) and `qrLoader.js` turns it back.

## Tests

- `tests/unit/qrChunks.test.js`: frames round-trip in any order with repeats, corrupt frames (data, total or index
  changed) and other transfers are refused, the frame limit, the missing list, the code's alphabet, `randomText`.
- `tests/regression/qr.ui.cjs` (`npm run test:qr`): a computer sends, a phone receives. The QR codes are taken from the
  sender's screen, then the code is shown (the loop stops; *Show the QR codes again* restarts it); the receiver's camera is a canvas filmed with `captureStream`, on which the test shows them in a
  shuffled order, with a repeat, a code of another transfer and a foreign QR code; the last missing code is named. Then a wrong code, the right one
  typed in lower case with spaces, the preview and the merge: the phone ends with exactly the computer's plans. A
  second round goes back the other way (one plan, changes on both sides), then the same codes again (Merge has nothing
  to do; *Add as separate copies*), a backup file imported through the same preview, a refused camera (then allowed: *Start over* starts it), and the file to
  hand out opened from disk (its embedded modules load under its security policy).
