/**
 * @file QR transfer: an (encrypted) payload split into frames for an animated loop of QR codes, and put back together
 * on the other device. Pure: no camera, no drawing (those are in ui/qr/). See docs/qr-transfer.md.
 *
 * A frame is one QR code's text:  RW1:<transfer id>:<index>:<total>:<crc32 of data>:<data>
 * (index from 1). The receiver takes frames in any order, skips duplicates, refuses one whose checksum or total is
 * wrong, and ignores codes of another transfer or that are not Runway's.
 */
const PREFIX = 'RW1';
/** Characters of payload per QR code: a code of this size still scans quickly from a phone screen. */
export const FRAME_SIZE = 500;

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

const randomText = (alphabet, n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map(b => alphabet[b % alphabet.length]).join('');

/** The frames of a payload. id: the transfer's id (random when not given). */
export function makeFrames(
  payload,
  { size = FRAME_SIZE, id = randomText('abcdefghijklmnopqrstuvwxyz0123456789', 6) } = {},
) {
  const total = Math.max(1, Math.ceil(payload.length / size));
  const frames = [];
  for (let i = 0; i < total; i++) {
    const data = payload.slice(i * size, (i + 1) * size);
    frames.push(`${PREFIX}:${id}:${i + 1}:${total}:${crc32(data)}:${data}`);
  }
  return frames;
}

/** A frame's parts, or null when the text is not a Runway frame. */
export function parseFrame(text) {
  const m = typeof text === 'string' && /^RW1:([a-z0-9]{6}):(\d{1,5}):(\d{1,5}):([0-9a-f]{8}):([\s\S]*)$/.exec(text);
  if (!m) {
    return null;
  }
  const index = +m[2];
  const total = +m[3];
  return index >= 1 && index <= total ? { id: m[1], index, total, crc: m[4], data: m[5] } : null;
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
  get received() {
    return this.parts.size;
  }
  get complete() {
    return this.total > 0 && this.parts.size === this.total;
  }
  missing() {
    const out = [];
    for (let i = 1; i <= this.total; i++) {
      if (!this.parts.has(i)) {
        out.push(i);
      }
    }
    return out;
  }
  /**
   * Takes one scanned text. status: 'added', 'duplicate', 'corrupt' (checksum or total wrong), 'other' (another
   * transfer), 'ignored' (not a Runway frame).
   */
  add(text) {
    const f = parseFrame(text);
    if (!f) {
      return { status: 'ignored' };
    }
    if (this.id && f.id !== this.id) {
      return { status: 'other' };
    }
    if (crc32(f.data) !== f.crc || (this.total && f.total !== this.total)) {
      this.corrupt++;
      return { status: 'corrupt', received: this.received, total: this.total, missing: this.missing() };
    }
    this.id = f.id;
    this.total = f.total;
    if (this.parts.has(f.index)) {
      this.duplicates++;
      return { status: 'duplicate', received: this.received, total: this.total, missing: this.missing() };
    }
    this.parts.set(f.index, f.data);
    return { status: 'added', received: this.received, total: this.total, missing: this.missing() };
  }
  /** The payload, once every frame is in. */
  payload() {
    if (!this.complete) {
      throw new Error(`Frames missing: ${this.missing().join(', ')}`);
    }
    return this.missing().length
      ? ''
      : [...this.parts.keys()]
          .sort((a, b) => a - b)
          .map(i => this.parts.get(i))
          .join('');
  }
}

/**
 * The code that encrypts a QR transfer, shown on the sending device and typed on the receiving one: 12 characters
 * without look-alikes (no 0/O, 1/I), about 60 bits.
 */
export function transferCode() {
  const t = randomText('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);
  return `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8)}`;
}
