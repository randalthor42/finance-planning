/**
 * @file Unit tests for QR transfer chunks (logic/qrChunks.js): split, any order, duplicates, corrupt and missing
 * chunks. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Receiver, crc32, makeFrames, parseFrame, transferCode } from '../../src/logic/qrChunks.js';

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
    assert.equal(p.crc, crc32(p.data));
    assert.ok(f.length <= 500 + 32, 'small enough for one QR code');
  });
  assert.equal(frames.map(f => parseFrame(f).data).join(''), payload);
  assert.match(makeFrames('x')[0], /^RW1:[a-z0-9]{6}:1:1:/, 'a random id when none is given');
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
  assert.deepEqual(r.add(frames[2]), { status: 'added', received: 1, total: frames.length, missing: [1, 2, 4, 5] });
  assert.equal(r.add(frames[2]).status, 'duplicate');
  r.add(frames[0]);
  assert.deepEqual(r.missing(), [2, 4, 5]);
  assert.equal(r.complete, false);
  assert.throws(() => r.payload(), /missing/i);
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

test('codes of another transfer, or that are not Runway’s, are ignored', () => {
  const r = new Receiver();
  r.add(makeFrames(payload, { size: 500, id: 'tx1234' })[0]);
  assert.equal(r.add(makeFrames(payload, { size: 500, id: 'other1' })[1]).status, 'other');
  assert.equal(r.add('https://example.com').status, 'ignored');
  assert.equal(r.add('RW1:bad').status, 'ignored');
  assert.equal(r.received, 1);
});

test('the transfer code: 12 letters and digits that cannot be confused, in groups of four', () => {
  const code = transferCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(transferCode(), code);
});
