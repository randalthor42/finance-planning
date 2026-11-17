/**
 * @file Moving plans between two devices with QR codes, with no network and no account (docs/qr-transfer.md).
 *
 * Sending: the plans become an encrypted backup (services/backup.js: gzip, then AES-GCM with a one-time code), split
 * into frames (logic/qrChunks.js) shown as a loop of QR codes. The code is shown next to them, never inside them.
 * Receiving: the camera reads the frames in any order until all are in, the code typed from the other screen opens
 * them, and the import preview (modals/importPreview.js) shows what merging would change.
 */
import { $t } from '../../core/i18n.js';
import { Receiver, makeFrames, transferCode } from '../../logic/qrChunks.js';
import { IO } from '../../services/backup.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { bar, segc } from '../components/layout.js';
import { modal } from '../components/modal.js';
import { h } from '../dom.js';
import { loadQr } from '../qrLoader.js';
import { importPreview } from './importPreview.js';

/** Frames per second of the loop: slower is easier for an old phone's camera. */
const SPEEDS = { slow: 2, normal: 4, fast: 8 };
/** More frames than this: a backup file or Drive sync is the better way (the loop takes minutes). */
const MANY_FRAMES = 240;

/** Puts these elements in the body, leaving out the nulls of parts not shown. */
const filler =
  body =>
  (...parts) =>
    body.replaceChildren(...parts.filter(Boolean));

/**
 * Keeps the screen on while codes are shown or scanned, where the browser can. Returns the function that lets it go;
 * called before the browser granted the lock, the lock is let go as soon as it arrives.
 */
function keepAwake() {
  let lock = null;
  let released = false;
  if (navigator.wakeLock) {
    navigator.wakeLock.request('screen').then(
      granted => {
        lock = granted;
        if (released) {
          lock.release().catch(() => {});
        }
      },
      () => {},
    );
  }
  return () => {
    released = true;
    if (lock) {
      lock.release().catch(() => {});
    }
  };
}

/* --- sending --- */

export function qrSendModal() {
  Store.cleanPlans();
  const many = Object.keys(Store.db.plans).length > 1;
  let scope = many ? 'all' : 'one';
  let timer = 0;
  let closed = false;
  let release = () => {};
  const body = h('div', { class: 'qr-send' });
  const fill = filler(body);
  const start = async () => {
    const code = transferCode();
    const plans = scope === 'all' ? Object.values(Store.db.plans) : [Store.plan];
    body.replaceChildren(h('p', { class: 'muted', text: $t('Preparing the codes…') }));
    let frames;
    let encode;
    try {
      // deleted plans travel with all plans, so a plan deleted here is deleted there too when merging
      // compressed: fewer QR codes to scan (both ends are this version)
      const extra = scope === 'all' ? { deletedPlans: Store.db.deletedPlans } : {};
      const payload = await IO.backup(plans, code, extra, { zip: true });
      frames = makeFrames(payload);
      encode = await loadQr('encode');
    } catch (e) {
      body.replaceChildren(
        h('p', { class: 'bad', text: $t('The QR codes could not be made: {0}', String((e && e.message) || e)) }),
      );
      return;
    }
    if (closed) {
      return; // closed while the codes were being made: no loop, no wake lock
    }
    show(code, frames, encode);
  };
  const show = (code, frames, { drawFrame }) => {
    let i = 0;
    let speed = 'normal';
    const canvas = h('canvas', { class: 'qr-canvas', 'aria-label': $t('QR code') });
    const counter = h('div', { class: 'small muted', 'data-qr-counter': '' });
    const seconds = () => Math.ceil(frames.length / SPEEDS[speed]);
    const loopNote = h('div', { class: 'small muted' });
    const step = () => {
      drawFrame(canvas, frames[i], { size: 480 });
      canvas.dataset.frame = String(i + 1);
      counter.textContent = $t('Code {0} of {1}', i + 1, frames.length);
      i = (i + 1) % frames.length;
    };
    const run = () => {
      clearInterval(timer);
      timer = setInterval(step, 1000 / SPEEDS[speed]);
      loopNote.textContent = $t('The codes repeat every {0} s until the other device has all of them.', seconds());
    };
    const speeds = () =>
      segc(
        [
          ['slow', $t('Slow')],
          ['normal', $t('Normal')],
          ['fast', $t('Fast')],
        ],
        speed,
        value => {
          speed = value;
          speedBox.replaceChildren(speeds());
          run();
        },
      );
    const speedBox = h('div', { class: 'qr-speed' }, speeds());
    fill(
      h(
        'p',
        { class: 'muted' },
        $t('On the other device: Settings › Storage › Move with QR codes › Receive. Point its camera at this code.'),
      ),
      canvas,
      h('div', { class: 'qr-meta' }, counter, speedBox),
      codeBox(code),
      loopNote,
      frames.length > MANY_FRAMES
        ? h('p', {
            class: 'small warn',
            text: $t('That is a lot of codes. A backup file or Google Drive sync is quicker for this much data.'),
          })
        : null,
    );
    step();
    run();
    release = keepAwake();
  };
  const chooser = () =>
    fill(
      h('p', {
        class: 'muted',
        text: $t(
          'Shows your plans as a loop of QR codes for the camera of your other device. No network is used. The codes are encrypted with a one-time code you type on the other device.',
        ),
      }),
      many
        ? h(
            'div',
            { class: 'qr-scope' },
            h('div', { class: 'small muted', text: $t('What to send') }),
            segc(
              [
                ['one', $t('This plan')],
                ['all', $t('All plans')],
              ],
              scope,
              value => {
                scope = value;
                chooser();
              },
            ),
          )
        : null,
      h('div', { class: 'acts', style: 'margin-top:14px' }, btn($t('Show the QR codes'), start, 'primary', 'qr')),
    );
  chooser();
  return modal({
    title: $t('Send with QR codes'),
    body,
    onClose: () => {
      closed = true;
      clearInterval(timer);
      release();
    },
  });
}

/**
 * The one-time code, hidden until the person asks for it: the codes on screen are encrypted with it, so a photo or a
 * film of the loop must not catch the code too. It is shown once the other device has scanned the codes.
 */
function codeBox(code) {
  const value = h('div', { class: 'qr-code', 'data-transfer-code': code, text: '••••-••••-••••' });
  const reveal = btn(
    $t('Show the code'),
    () => {
      value.textContent = code;
      reveal.remove();
    },
    'sm ghost',
  );
  return h(
    'div',
    { class: 'qr-code-box' },
    h('div', {
      class: 'small muted',
      text: $t('When the other device has every code, show this code and type it there:'),
    }),
    value,
    reveal,
  );
}

/* --- receiving --- */

/** Reads QR codes from the video: the browser's BarcodeDetector, or the bundled reader (qr-decode.js). */
async function qrReader() {
  if (typeof BarcodeDetector === 'function') {
    try {
      if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        return async video => (await detector.detect(video)).map(c => c.rawValue);
      }
    } catch (e) {}
  }
  const { decode } = await loadQr('decode');
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  return async video => {
    const w = video.videoWidth;
    const hh = video.videoHeight;
    if (!w || !hh) {
      return [];
    }
    // at most 960 px across: enough for a code that fills a good part of the picture, and quick to read
    const scale = Math.min(1, 960 / Math.max(w, hh));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(hh * scale);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const text = decode(g.getImageData(0, 0, canvas.width, canvas.height));
    return text ? [text] : [];
  };
}

/** Why the camera could not be used, in words. */
function cameraError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return $t('Runway may not use the camera. Allow it in the browser’s site settings, then try again.');
  }
  if (name === 'NotFoundError') {
    return $t('No camera was found on this device.');
  }
  return $t('The camera could not be started: {0}', String((e && e.message) || e));
}

/** The code as typed (any case, spaces or no dashes) written as it is shown: ABCD-EFGH-JKLM. */
export const cleanCode = text => {
  const t = String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return t.length === 12 ? `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8)}` : t;
};

export function qrReceiveModal() {
  let receiver = new Receiver();
  let stream = null;
  let timer = 0;
  let closed = false;
  let release = () => {};
  const video = h('video', { class: 'qr-video', muted: true, playsinline: true, autoplay: true });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const progressText = h('div', { class: 'small', 'data-qr-progress': '', 'aria-live': 'polite' });
  const progressBar = h('div', { class: 'qr-bar' });
  const message = h('div', { class: 'small', role: 'alert', 'data-qr-message': '' });
  const body = h('div', { class: 'qr-receive' });
  const say = (text, tone = '') => {
    message.textContent = text;
    message.className = 'small ' + tone;
  };
  const stop = () => {
    clearTimeout(timer);
    timer = 0;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.srcObject = null;
    release();
  };
  const progress = () => {
    const total = receiver.total;
    progressText.textContent = total
      ? $t('Scanned {0} of {1}', receiver.received, total)
      : $t('Point the camera at the codes on the other device.');
    progressBar.replaceChildren(bar(total ? Math.round((receiver.received / total) * 100) : 0, 'good'));
  };
  let scans = 0;
  const take = text => {
    const r = receiver.add(text);
    // every code read, new or not, and the start of the last one (the browser test waits on them)
    body.dataset.scans = String(++scans);
    body.dataset.last = text.slice(0, 24);
    if (r.status === 'added') {
      say('');
    } else if (r.status === 'corrupt') {
      say($t('A code was misread. Keep the camera on the codes: it comes round again.'), 'warn');
    } else if (r.status === 'other') {
      say($t('These codes are from another transfer. Tap Start over to scan the new one.'), 'warn');
    } else if (r.status === 'ignored') {
      say($t('That is not a Runway transfer code.'), 'warn');
    }
    progress();
    if (receiver.complete) {
      stop();
      askCode(receiver.payload());
    }
  };
  const scan = async () => {
    body.replaceChildren(
      h('p', {
        class: 'muted',
        text: $t(
          'On the other device: Settings › Storage › Move with QR codes › Send. Point this camera at its codes.',
        ),
      }),
      video,
      progressText,
      progressBar,
      message,
      h(
        'div',
        { class: 'acts', style: 'margin-top:12px' },
        btn(
          $t('Start over'),
          () => {
            receiver = new Receiver();
            say('');
            progress();
          },
          'ghost',
          'refresh',
        ),
      ),
    );
    progress();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return say(
        $t('This browser cannot use the camera here. Open Runway from its web address or the installed app.'),
        'bad',
      );
    }
    // the reader first: if it cannot be loaded, the camera is never turned on
    let read;
    try {
      read = await qrReader();
    } catch (e) {
      return say($t('The QR reader could not be loaded: {0}', String((e && e.message) || e)), 'bad');
    }
    if (closed) {
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      return say(cameraError(e), 'bad');
    }
    if (closed) {
      return stop();
    }
    release = keepAwake();
    video.srcObject = stream;
    video.play().catch(() => {});
    const tick = async () => {
      timer = 0;
      if (closed || !stream) {
        return;
      }
      try {
        for (const text of await read(video)) {
          take(text);
          if (!stream) {
            return;
          }
        }
      } catch (e) {}
      if (stream && !closed) {
        timer = setTimeout(tick, 60);
      }
    };
    tick();
  };
  const askCode = payload => {
    const input = h('input', {
      class: 'inp qr-code-input',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      'aria-label': $t('Code from the other device'),
      placeholder: 'XXXX-XXXX-XXXX',
      maxlength: 20,
    });
    const open = async () => {
      const code = cleanCode(input.value);
      if (!code) {
        return say($t('Type the code shown on the other device.'), 'bad');
      }
      say($t('Opening…'));
      try {
        const read = await IO.read(payload, code);
        if (read.needsPassword) {
          return say($t('Type the code shown on the other device.'), 'bad');
        }
        d.close();
        importPreview(read, 'qr');
      } catch (e) {
        say(e.code === 'password' ? $t('That code does not match. Check it on the other device.') : e.message, 'bad');
      }
    };
    const form = h(
      'form',
      {
        class: 'qr-open',
        onsubmit: e => {
          e.preventDefault();
          open();
        },
      },
      h('label', { class: 'small muted', text: $t('Every code is in. Type the code shown on the other device:') }),
      input,
      h(
        'div',
        { class: 'acts', style: 'margin-top:12px' },
        h('button', { type: 'submit', class: 'btn primary', text: $t('Open') }),
        btn(
          $t('Scan again'),
          () => {
            receiver = new Receiver();
            scan();
          },
          'ghost',
          'refresh',
        ),
      ),
    );
    body.replaceChildren(progressText, form, message);
    say('');
    input.focus();
  };
  const d = modal({
    title: $t('Receive with QR codes'),
    body,
    onClose: () => {
      closed = true;
      stop();
    },
  });
  scan();
  return d;
}
