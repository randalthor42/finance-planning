/**
 * @file Moving plans between two devices with QR codes, with no network and no account (docs/qr-transfer.md).
 *
 * Sending: the plans become an encrypted backup (services/backup.js: gzip, then AES-GCM with a one-time code), split
 * into frames (logic/qrChunks.js) shown as a loop of QR codes. The code is never inside them: it stays hidden until
 * the person asks for it, and the loop stops while it is shown.
 * Receiving: the camera reads the frames in any order until all are in, the code typed from the other screen opens
 * them, and the import preview (modals/importPreview.js) shows what merging would change.
 */
import { $t } from '../../core/i18n.js';
import { randomText } from '../../core/util.js';
import { CODE_CHARS, ID_CHARS, Receiver, makeFrames, transferCode } from '../../logic/qrChunks.js';
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
/** The receiver lists the missing codes once at most this many are left (or once a whole loop has gone by). */
const FEW_MISSING = 5;
/** The most missing codes listed at once. */
const MISSING_LISTED = 10;

/** Puts these elements in the body, leaving out the nulls of parts not shown. */
const filler =
  body =>
  (...parts) =>
    body.replaceChildren(...parts.filter(Boolean));

/**
 * Keeps the screen on while codes are shown or scanned, where the browser can. The browser lets the lock go when the
 * page is hidden, so it is asked for again when the page is shown again. Returns the function that lets it go and
 * stops asking; called before the browser granted the lock, the lock is let go as soon as it arrives.
 */
function keepAwake() {
  if (!navigator.wakeLock) {
    return () => {};
  }
  let lock = null;
  let released = false;
  const request = () => {
    navigator.wakeLock.request('screen').then(
      granted => {
        if (released) {
          granted.release().catch(() => {});
          return;
        }
        lock = granted;
      },
      () => {},
    );
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !released) {
      request();
    }
  };
  request();
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisibility);
    if (lock) {
      lock.release().catch(() => {});
      lock = null;
    }
  };
}

/** Why the QR codes could not be made, in words. */
function sendError(e) {
  if (e && e.code === 'too-many') {
    return $t('That is too much data for QR codes. Use a backup file or Google Drive sync.');
  }
  return $t('The QR codes could not be made: {0}', String((e && e.message) || e));
}

/* --- sending --- */

/**
 * Opens the "Send with QR codes" window: this plan or all plans, then a loop of QR codes of them, encrypted with a
 * one-time code shown on request. The loop, the wake lock and the code's key are let go when it closes.
 * @returns {Object} the modal
 */
export function qrSendModal() {
  Store.cleanPlans();
  const many = Object.keys(Store.db.plans).length > 1;
  let scope = many ? 'all' : 'one';
  let timer = 0;
  let closed = false;
  let code = null;
  let release = () => {};
  const body = h('div', { class: 'qr-send' });
  const fill = filler(body);
  const start = async () => {
    code = transferCode(randomText(CODE_CHARS, 12));
    const plans = scope === 'all' ? Object.values(Store.db.plans) : [Store.plan];
    body.replaceChildren(h('p', { class: 'muted', text: $t('Preparing the codes…') }));
    let frames;
    let encode;
    try {
      // deleted plans travel with all plans, so a plan deleted here is deleted there too when merging
      // compressed: fewer QR codes to scan (both ends are this version)
      const extra = scope === 'all' ? { deletedPlans: Store.db.deletedPlans } : {};
      const payload = await IO.backup(plans, code, extra, { zip: true });
      frames = makeFrames(payload, { id: randomText(ID_CHARS, 6) });
      encode = await loadQr('encode');
    } catch (e) {
      body.replaceChildren(h('p', { class: 'bad', text: sendError(e) }));
      return;
    }
    if (closed) {
      IO.forget(code); // closed while the codes were being made: no loop, no wake lock, no key kept
      return;
    }
    show(frames, encode);
  };
  const show = (frames, { drawFrame }) => {
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
    const loopBox = h('div', { class: 'qr-loop' });
    const showLoop = () => {
      loopBox.replaceChildren(canvas, h('div', { class: 'qr-meta' }, counter, speedBox), loopNote);
      step();
      run();
    };
    // the code is shown: the loop stops, so one photo cannot catch both; it can be shown again for missed codes
    const stopLoop = () => {
      clearInterval(timer);
      timer = 0;
      loopBox.replaceChildren(
        h('p', {
          class: 'small muted',
          text: $t(
            'The QR codes are stopped while the code is shown. Show them again if the other device still needs some.',
          ),
        }),
        h(
          'div',
          { class: 'acts' },
          btn(
            $t('Show the QR codes again'),
            () => {
              shownCode.hide();
              showLoop();
            },
            'ghost',
            'qr',
          ),
        ),
      );
    };
    const shownCode = codeBox(code, stopLoop);
    fill(
      h(
        'p',
        { class: 'muted' },
        $t('On the other device: Settings › Storage › Move with QR codes › Receive. Point its camera at this code.'),
      ),
      loopBox,
      shownCode.el,
      frames.length > MANY_FRAMES
        ? h('p', {
            class: 'small warn',
            text: $t('That is a lot of codes. A backup file or Google Drive sync is quicker for this much data.'),
          })
        : null,
    );
    showLoop();
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
      if (code) {
        IO.forget(code);
      }
    },
  });
}

/**
 * The one-time code, hidden until the person asks for it: the codes on screen are encrypted with it, so a photo or a
 * film of the loop must not catch the code too. It is shown once the other device has scanned the codes, and
 * onReveal then stops the loop. hide() covers it again, for when the loop is shown again.
 * @returns {{el: HTMLElement, hide: function(): void}}
 */
function codeBox(code, onReveal) {
  const dots = '••••-••••-••••';
  const value = h('div', { class: 'qr-code', 'data-transfer-code': code, text: dots });
  const reveal = btn(
    $t('Show the code'),
    () => {
      value.textContent = code;
      reveal.remove();
      onReveal();
    },
    'sm ghost',
  );
  const el = h(
    'div',
    { class: 'qr-code-box' },
    h('div', {
      class: 'small muted',
      text: $t('When the other device has every code, show this code and type it there:'),
    }),
    value,
    reveal,
  );
  const hide = () => {
    value.textContent = dots;
    value.after(reveal);
  };
  return { el, hide };
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

/**
 * Which codes are still awaited, once that helps: when only a few are missing, or when a whole loop (at the slowest
 * speed) has gone by since the first code was read. Empty otherwise.
 * @param {Receiver} receiver
 * @param {number} waitedMs time since the first code was read (0: none yet)
 * @returns {string}
 */
function waitingFor(receiver, waitedMs) {
  const left = receiver.total - receiver.received;
  if (!receiver.total || left === 0) {
    return '';
  }
  const loopGoneBy = waitedMs >= (receiver.total / SPEEDS.slow) * 1000;
  if (left > FEW_MISSING && !loopGoneBy) {
    return '';
  }
  const listed = receiver.missing(MISSING_LISTED);
  let list = listed.join(', ');
  if (left > listed.length) {
    list += ', …';
  }
  return $t('Waiting for codes {0}', list);
}

/** The code as typed (any case, spaces or no dashes) written as it is shown: ABCD-EFGH-JKLM. */
export const cleanCode = text => {
  const t = String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return t.length === 12 ? `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8)}` : t;
};

/**
 * Opens the "Receive with QR codes" window: the camera reads the other device's codes until all are in, then the
 * one-time code typed here opens them and the import preview shows what would change. The camera, the wake lock and
 * any key made for a typed code are let go when it closes.
 * @returns {Object} the modal
 */
export function qrReceiveModal() {
  let receiver = new Receiver();
  let stream = null;
  let starting = false;
  let timer = 0;
  let closed = false;
  let firstAt = 0;
  let release = () => {};
  const typedCodes = new Set();
  const video = h('video', { class: 'qr-video', muted: true, playsinline: true, autoplay: true });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const progressText = h('div', { class: 'small', 'data-qr-progress': '', 'aria-live': 'polite' });
  const progressBar = h('div', { class: 'qr-bar' });
  const waitingText = h('div', { class: 'small muted', 'data-qr-missing': '' });
  const message = h('div', { class: 'small', role: 'alert', 'data-qr-message': '' });
  const body = h('div', { class: 'qr-receive' });
  const say = (text, tone = '') => {
    message.textContent = text;
    message.className = 'small ' + tone;
  };
  const forgetCodes = () => {
    typedCodes.forEach(typed => IO.forget(typed));
    typedCodes.clear();
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
    release = () => {};
  };
  const progress = () => {
    const total = receiver.total;
    progressText.textContent = total
      ? $t('Scanned {0} of {1}', receiver.received, total)
      : $t('Point the camera at the codes on the other device.');
    progressBar.replaceChildren(bar(total ? Math.round((receiver.received / total) * 100) : 0, 'good'));
    waitingText.textContent = waitingFor(receiver, firstAt ? Date.now() - firstAt : 0);
  };
  const restart = () => {
    receiver = new Receiver();
    firstAt = 0;
  };
  let scans = 0;
  const take = text => {
    const r = receiver.add(text);
    // every code read, new or not, and the start of the last one (the browser test waits on them)
    body.dataset.scans = String(++scans);
    body.dataset.last = text.slice(0, 24);
    if (r.status === 'added') {
      if (!firstAt) {
        firstAt = Date.now();
      }
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
  const startOver = () => {
    restart();
    say('');
    progress();
    // the camera failed or was never started: try it again
    if (!stream && !starting) {
      scan();
    }
  };
  const scanScreen = () =>
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
      waitingText,
      message,
      h('div', { class: 'acts', style: 'margin-top:12px' }, btn($t('Start over'), startOver, 'ghost', 'refresh')),
    );
  const startCamera = async () => {
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
  const scan = async () => {
    scanScreen();
    say('');
    progress();
    starting = true;
    try {
      await startCamera();
    } finally {
      starting = false;
    }
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
      typedCodes.add(code);
      try {
        const read = await IO.read(payload, code);
        if (read.needsPassword) {
          return say($t('Type the code shown on the other device.'), 'bad');
        }
        forgetCodes(); // opened: the code's key is not needed any more
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
            forgetCodes();
            restart();
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
      forgetCodes();
    },
  });
  scan();
  return d;
}
