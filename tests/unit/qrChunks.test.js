/**
 * @file Unit tests for QR transfer chunks (logic/qrChunks.js): split, any order, duplicates, corrupt and missing
 * chunks. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomText } from '../../src/core/util.js';
import {
  CODE_CHARS,
  MAX_FRAMES,
  Receiver,
  crc32,
  makeFrames,
  parseFrame,
  transferCode,
} from '../../src/logic/qrChunks.js';

const payload = JSON.stringify({ app: 'runway', kind: 'encrypted', data: 'x'.repeat(2300) + 'é€ end' });
const shuffle = list =>
  list
    .map(v => [Math.sin(v.length * 7919 + list.indexOf(v)), v])
    .sort((a, b) => a[0] - b[0])
    .map(x => x[1]);

test('crc32: the standard checksum', () => {
  assert.equal(crc32('123456789'), 'cbf43926');
  assert.equal(crc32(''), '00000000');
  assert.notEqual(crc32('abc'), crc32('abd'));
});

test('a payload becomes frames with index, total, transfer id and checksum', () => {
  const frames = makeFrames(payload, { size: 500, id: 'tx1234' });
  assert.equal(frames.length, Math.ceil(payload.length / 500));
  frames.forEach((f, i) => {
    const p = parseFrame(f);
    assert.deepEqual([p.id, p.index, p.total], ['tx1234', i + 1, frames.length]);
    assert.equal(p.crc, crc32(`tx1234:${i + 1}:${frames.length}:${p.data}`), 'the checksum covers id, index and total');
    assert.ok(f.length <= 500 + 32, 'small enough for one QR code');
  });
  assert.equal(frames.map(f => parseFrame(f).data).join(''), payload);
  assert.match(makeFrames('x', { id: 'abc123' })[0], /^RW1:abc123:1:1:/);
});

test('frames in any order, with duplicates, give the payload back', () => {
  const frames = makeFrames(payload, { size: 300, id: 'tx1234' });
  const r = new Receiver();
  let last;
  for (const f of shuffle([...frames, ...frames.slice(0, 3), frames[5]])) {
    last = r.add(f);
  }
  assert.equal(last.total, frames.length);
  assert.equal(r.complete, true);
  assert.equal(r.payload(), payload);
  assert.equal(r.duplicates, 4);
});

test('progress: how many of how many, and which are missing', () => {
  const frames = makeFrames(payload, { size: 500, id: 'tx1234' });
  const r = new Receiver();
  assert.deepEqual(r.add(frames[2]), { status: 'added', received: 1, total: frames.length });
  assert.deepEqual(r.missing(), [1, 2, 4, 5]);
  assert.equal(r.add(frames[2]).status, 'duplicate');
  r.add(frames[0]);
  assert.deepEqual(r.missing(), [2, 4, 5]);
  assert.deepEqual(r.missing(2), [2, 4], 'at most as many as asked for');
  assert.equal(r.complete, false);
  assert.equal(r.payload(), null);
});

test('a corrupt frame (the checksum does not match) is refused; the good one is taken later', () => {
  const frames = makeFrames(payload, { size: 500, id: 'tx1234' });
  const r = new Receiver();
  const broken = frames[1].slice(0, -3) + 'zzz';
  assert.equal(r.add(broken).status, 'corrupt');
  assert.equal(r.corrupt, 1);
  assert.equal(r.received, 0);
  frames.forEach(f => r.add(f));
  assert.equal(r.payload(), payload);
});

test('a frame whose total does not match the transfer is corrupt', () => {
  const frames = makeFrames(payload, { size: 500, id: 'tx1234' });
  const r = new Receiver();
  r.add(frames[0]);
  const liar = frames[1].replace(/^RW1:tx1234:2:\d+:/, 'RW1:tx1234:2:99:');
  assert.equal(r.add(liar).status, 'corrupt');
});

test('a frame whose index was changed is corrupt (the checksum covers the index)', () => {
  const frames = makeFrames(payload, { size: 500, id: 'tx1234' });
  const r = new Receiver();
  r.add(frames[0]);
  const moved = frames[1].replace(/^RW1:tx1234:2:/, 'RW1:tx1234:3:');
  assert.equal(r.add(moved).status, 'corrupt');
  assert.equal(r.received, 1);
});

test('more than MAX_FRAMES frames: not made, and such a code is not a Runway code', () => {
  assert.throws(
    () => makeFrames('x'.repeat(MAX_FRAMES + 1), { size: 1, id: 'tx1234' }),
    e => e.code === 'too-many',
  );
  assert.equal(makeFrames('x'.repeat(MAX_FRAMES), { size: 1, id: 'tx1234' }).length, MAX_FRAMES);
  const data = 'abc';
  const tooLong = `RW1:tx1234:1:${MAX_FRAMES + 1}:${crc32(`tx1234:1:${MAX_FRAMES + 1}:${data}`)}:${data}`;
  assert.equal(parseFrame(tooLong), null);
  assert.equal(new Receiver().add(tooLong).status, 'ignored');
});

test('codes of another transfer, or that are not Runway’s, are ignored', () => {
  const r = new Receiver();
  r.add(makeFrames(payload, { size: 500, id: 'tx1234' })[0]);
  assert.equal(r.add(makeFrames(payload, { size: 500, id: 'other1' })[1]).status, 'other');
  assert.equal(r.add('https://example.com').status, 'ignored');
  assert.equal(r.add('RW1:bad').status, 'ignored');
  assert.equal(r.received, 1);
});

test('the transfer code: 12 letters and digits that cannot be confused, in groups of four', () => {
  assert.equal(transferCode('ABCDEFGHJKLM'), 'ABCD-EFGH-JKLM');
  const code = transferCode(randomText(CODE_CHARS, 12));
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(transferCode(randomText(CODE_CHARS, 12)), code);
});

test('randomText: the length asked for, only characters of the alphabet, each about as likely', () => {
  assert.equal(randomText('ab', 0), '');
  const text = randomText('abc', 30000);
  assert.equal(text.length, 30000);
  assert.match(text, /^[abc]+$/);
  for (const c of 'abc') {
    const share = text.split(c).length - 1;
    assert.ok(share > 9000 && share < 11000, `${c}: ${share} of 30000`);
  }
});
