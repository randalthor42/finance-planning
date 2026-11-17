/**
 * @file QR transfer: an (encrypted) payload split into frames for an animated loop of QR codes, and put back together
 * on the other device. Pure: no camera, no drawing (those are in ui/qr/), no randomness (the transfer id and the
 * one-time code are drawn by the caller, with core/util.js randomText). See docs/qr-transfer.md.
 *
 * A frame is one QR code's text:  RW1:<transfer id>:<index>:<total>:<crc32 of id:index:total:data>:<data>
 * (index from 1, at most MAX_FRAMES frames). The receiver takes frames in any order, skips duplicates, refuses one
 * whose checksum or total is wrong, and ignores codes of another transfer or that are not Runway's.
 */
const PREFIX = 'RW1';
/** Characters of payload per QR code: a code of this size still scans quickly from a phone screen. */
export const FRAME_SIZE = 500;
/**
 * The most frames a transfer may have (500,000 characters at FRAME_SIZE, a loop of minutes). A code that says it is
 * part of a longer transfer is not Runway's.
 */
export const MAX_FRAMES = 1000;
/** The characters of a transfer id (6 of them, in every frame). */
export const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** The characters of the one-time code: letters and digits without look-alikes (no 0/O, 1/I). */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let table = null;
/** CRC-32 (IEEE) of the text's UTF-8 bytes, as 8 hex digits. */
export function crc32(text) {
  if (!table) {
    table = new Uint32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return c >>> 0;
    });
  }
  let c = 0xffffffff;
  for (const b of new TextEncoder().encode(text)) {
    c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/**
 * The checksum of a frame: over its id, index and total as well as its data, so a misread index or total is caught
 * too. Frames made by earlier builds (checksum of the data only) are not read: both ends of a transfer are the same
 * version of the app.
 */
const frameCrc = (id, index, total, data) => crc32(`${id}:${index}:${total}:${data}`);

/**
 * The frames of a payload.
 * @param {string} payload
 * @param {{id: string, size?: number}} options id: the transfer's id, 6 of ID_CHARS (drawn by the caller)
 * @returns {string[]} one QR code's text per frame
 * @throws {Error} with code 'too-many' when the payload needs more than MAX_FRAMES frames
 */
export function makeFrames(payload, { id, size = FRAME_SIZE }) {
  const total = Math.max(1, Math.ceil(payload.length / size));
  if (total > MAX_FRAMES) {
    throw Object.assign(new Error('Too much data for QR codes'), { code: 'too-many' });
  }
  const frames = [];
  for (let i = 0; i < total; i++) {
    const data = payload.slice(i * size, (i + 1) * size);
    frames.push(`${PREFIX}:${id}:${i + 1}:${total}:${frameCrc(id, i + 1, total, data)}:${data}`);
  }
  return frames;
}

/** A frame's parts, or null when the text is not a Runway frame (including one that claims over MAX_FRAMES). */
export function parseFrame(text) {
  const m = typeof text === 'string' && /^RW1:([a-z0-9]{6}):(\d{1,5}):(\d{1,5}):([0-9a-f]{8}):([\s\S]*)$/.exec(text);
  if (!m) {
    return null;
  }
  const index = +m[2];
  const total = +m[3];
  if (index < 1 || index > total || total > MAX_FRAMES) {
    return null;
  }
  return { id: m[1], index, total, crc: m[4], data: m[5] };
}

/** Collects the frames of one transfer. add() each scanned text; payload() when complete. */
export class Receiver {
  constructor() {
    this.id = null;
    this.total = 0;
    this.parts = new Map();
    this.duplicates = 0;
    this.corrupt = 0;
  }
  /** How many different frames are in. */
  get received() {
    return this.parts.size;
  }
  /** True once every frame of the transfer is in. */
  get complete() {
    return this.total > 0 && this.parts.size === this.total;
  }
  /**
   * The indexes still missing, in order; at most `limit` of them. Worked out only when asked for (to show them), not
   * on every scan.
   * @returns {number[]}
   */
  missing(limit = Infinity) {
    const out = [];
    for (let i = 1; i <= this.total && out.length < limit; i++) {
      if (!this.parts.has(i)) {
        out.push(i);
      }
    }
    return out;
  }
  /**
   * Takes one scanned text. status: 'added', 'duplicate', 'corrupt' (checksum or total wrong), 'other' (another
   * transfer), 'ignored' (not a Runway frame).
   * @returns {{status: string, received?: number, total?: number}}
   */
  add(text) {
    const f = parseFrame(text);
    if (!f) {
      return { status: 'ignored' };
    }
    if (this.id && f.id !== this.id) {
      return { status: 'other' };
    }
    if (frameCrc(f.id, f.index, f.total, f.data) !== f.crc || (this.total && f.total !== this.total)) {
      this.corrupt++;
      return { status: 'corrupt', received: this.received, total: this.total };
    }
    this.id = f.id;
    this.total = f.total;
    if (this.parts.has(f.index)) {
      this.duplicates++;
      return { status: 'duplicate', received: this.received, total: this.total };
    }
    this.parts.set(f.index, f.data);
    return { status: 'added', received: this.received, total: this.total };
  }
  /** The payload once every frame is in; null while frames are missing. */
  payload() {
    if (!this.complete) {
      return null;
    }
    return [...this.parts.keys()]
      .sort((a, b) => a - b)
      .map(i => this.parts.get(i))
      .join('');
  }
}

/**
 * The code that encrypts a QR transfer, shown on the sending device and typed on the receiving one, written in groups
 * of four: ABCD-EFGH-JKLM. chars: 12 random characters of CODE_CHARS (about 60 bits), drawn by the caller.
 * @param {string} chars
 * @returns {string}
 */
export function transferCode(chars) {
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
