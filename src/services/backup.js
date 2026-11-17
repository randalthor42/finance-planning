/**
 * @file Backup files: JSON export and import, optional AES-GCM encryption, CSV. The same format carries Drive sync's
 * file (state/driveSync.js) and QR transfers (ui/modals/qrTransfer.js): see docs/sync.md.
 *
 *   { app: 'runway', kind: 'backup', v, exported, plans: [...], deletedPlans?: {...} }
 *   encrypted: { app: 'runway', kind: 'encrypted', v: 1, kdf, cipher, iter, salt, iv, zip?: 'gzip', data }
 *
 * An encrypted file's text is compressed (gzip) before it is encrypted when the browser can (zip: 'gzip'); older
 * files without `zip` open as before.
 */
import { APP } from '../config.js';
import { D } from '../core/dates.js';
import { FMT } from '../core/format.js';
import { $t } from '../core/i18n.js';
import { clamp, isObj } from '../core/util.js';
import { CAT_NAME } from '../models/categories.js';

export const IO = {
  ITER: 310000,
  MAX_BYTES: 5e6,
  b64: u8 => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  },
  unb64: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
  canEncrypt: () => typeof crypto !== 'undefined' && !!crypto.subtle,
  /** The key of each passphrase in this visit ({salt, key}): sync encrypts often, PBKDF2 is slow on purpose. */
  keys: new Map(),
  canZip: () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function',
  async zip(bytes, how) {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(how === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
  async key(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  },
  /**
   * Encrypts text with a passphrase: AES-256-GCM, the key from PBKDF2-SHA256 (ITER rounds, random salt), a new random
   * IV every time. The key of a passphrase is made once per visit (keys). zip: compress first (default when able).
   */
  /**
   * The encrypted envelope of a text. zip: compress before encrypting (Drive sync and QR transfers, where both ends
   * are this version). Such an envelope says v: 2, so that it is told apart; an exported backup is not compressed
   * (v: 1), so older versions of the app can still open it.
   */
  async encrypt(text, password, { zip = false } = {}) {
    zip = zip && this.canZip();
    let known = this.keys.get(password);
    if (!known) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      known = { salt, key: await this.key(password, salt, this.ITER) };
      this.keys.set(password, known);
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(text);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      known.key,
      zip ? await this.zip(bytes, 'gzip') : bytes,
    );
    return {
      app: 'runway',
      kind: 'encrypted',
      v: zip ? 2 : 1,
      kdf: 'PBKDF2-SHA256',
      cipher: 'AES-256-GCM',
      iter: this.ITER,
      salt: this.b64(known.salt),
      iv: this.b64(iv),
      ...(zip ? { zip: 'gzip' } : {}),
      data: this.b64(new Uint8Array(ct)),
    };
  },
  async decrypt(f, password) {
    const iter = clamp(Math.round(+f.iter) || 0, 10000, 5000000);
    const known = this.keys.get(password);
    const key =
      known && this.b64(known.salt) === f.salt && iter === this.ITER
        ? known.key
        : await this.key(password, this.unb64(f.salt), iter);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.unb64(f.iv) }, key, this.unb64(f.data));
    return new TextDecoder().decode(f.zip === 'gzip' ? await this.zip(new Uint8Array(pt), 'gunzip') : pt);
  },
  /**
   * The backup text of these plans; extra: more fields (a QR transfer adds deletedPlans). zip: compress the encrypted
   * text (see encrypt).
   */
  async backup(plans, password, extra = {}, { zip = false } = {}) {
    const body = { app: 'runway', kind: 'backup', v: APP.schema, exported: new Date().toISOString(), ...extra, plans };
    if (!password) {
      return JSON.stringify(body, null, 1);
    }
    return JSON.stringify(await this.encrypt(JSON.stringify(body), password, { zip }));
  },
  /**
   * The same backup text (unencrypted, compact) from plan texts already made (PlanStore.planList): Drive sync writes
   * it often, so plans are not serialised again. extra: fields before the plans.
   */
  backupText(planTexts, extra = {}) {
    const head = JSON.stringify({
      app: 'runway',
      kind: 'backup',
      v: APP.schema,
      exported: new Date().toISOString(),
      ...extra,
    });
    return head.slice(0, -1) + (head.length > 2 ? ',' : '') + '"plans":[' + planTexts.join(',') + ']}';
  },
  /**
   * Parses backup text. Returns {plans, deletedPlans} or {needsPassword:true} or throws a readable Error.
   * `allowEmpty`: a file with no plans is valid (the Drive sync file of an account whose plans were all deleted, or
   * of a device that turned sync on before making one); an imported backup with none is refused.
   */
  async read(text, password, { allowEmpty = false } = {}) {
    let f;
    try {
      f = JSON.parse(text);
    } catch (e) {
      throw new Error($t('This file is not a valid backup (it is not JSON).'));
    }
    if (!isObj(f) || f.app !== 'runway') {
      throw new Error($t('This file was not made by ') + APP.name + '.');
    }
    if (f.kind === 'encrypted') {
      if (!this.canEncrypt()) {
        throw new Error($t('This browser cannot open encrypted backups.'));
      }
      if (!password) {
        return { needsPassword: true };
      }
      let inner;
      try {
        inner = await this.decrypt(f, password);
      } catch (e) {
        throw Object.assign(new Error($t('Wrong password, or the file is damaged.')), { code: 'password' });
      }
      return this.read(inner, '', { allowEmpty });
    }
    // a data file (models/dataFile.js) has the same shape: it can be imported like a backup
    if ((f.kind !== 'backup' && f.kind !== 'data') || !Array.isArray(f.plans) || (!f.plans.length && !allowEmpty)) {
      throw new Error($t('This backup has no plans in it.'));
    }
    if (+f.v > APP.schema) {
      throw new Error($t('This backup was made by a newer version of ') + APP.name + '.');
    }
    return {
      plans: f.plans.slice(0, APP.maxPlans).filter(isObj),
      deletedPlans: isObj(f.deletedPlans) ? f.deletedPlans : {},
    };
  },
  download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
  /**
   * Rows of cells as CSV text (opens in Excel). Cells that could be read as a formula are neutralised.
   * With the European number format, Excel (es-ES, ro-RO, de-DE…) expects ";" between cells and "," in decimals,
   * so those are used. The text starts with a byte order mark so accents survive.
   */
  csvText(rows) {
    const european = FMT.dec === ',';
    const separator = european ? ';' : ',';
    const quote = value => {
      let text = String(value);
      if (/^[=+\-@\t\r]/.test(text) && isNaN(+text)) {
        text = "'" + text;
      }
      if (european && /^-?\d+\.\d+$/.test(text)) {
        text = text.replace('.', ',');
      }
      const needsQuotes = text.includes('"') || text.includes(separator) || text.includes('\n');
      return needsQuotes ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    return '﻿' + rows.map(row => row.map(quote).join(separator)).join('\n');
  },
  csv(proj) {
    const rows = [
      [
        $t('Month'),
        $t('Date'),
        $t('Type'),
        $t('Name'),
        $t('Detail'),
        $t('Category'),
        $t('Amount'),
        $t('Cash at month end'),
      ],
    ];
    for (const m of proj.months) {
      for (const e of m.entries) {
        rows.push([
          m.key,
          e.date == null ? '' : D.key(e.date),
          e.group,
          e.label,
          e.sub || '',
          CAT_NAME[e.cat] || '',
          e.amount.toFixed(2),
          '',
        ]);
      }
      rows.push([m.key, D.key(m.end), 'balance', $t('Cash at month end'), '', '', '', m.close.toFixed(2)]);
    }
    return IO.csvText(rows);
  },
};
