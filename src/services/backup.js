/**
 * @file Backup files: JSON export and import, optional AES-GCM encryption, CSV.
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
  async encrypt(text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.key(password, salt, this.ITER),
      new TextEncoder().encode(text),
    );
    return {
      app: 'runway',
      kind: 'encrypted',
      v: 1,
      kdf: 'PBKDF2-SHA256',
      cipher: 'AES-256-GCM',
      iter: this.ITER,
      salt: this.b64(salt),
      iv: this.b64(iv),
      data: this.b64(new Uint8Array(ct)),
    };
  },
  async decrypt(f, password) {
    const iter = clamp(Math.round(+f.iter) || 0, 10000, 5000000);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.unb64(f.iv) },
      await this.key(password, this.unb64(f.salt), iter),
      this.unb64(f.data),
    );
    return new TextDecoder().decode(pt);
  },
  async backup(plans, password) {
    const body = { app: 'runway', kind: 'backup', v: APP.schema, exported: new Date().toISOString(), plans };
    return JSON.stringify(password ? await this.encrypt(JSON.stringify(body), password) : body, null, password ? 0 : 1);
  },
  /** Parses backup text. Returns {plans} or {needsPassword:true} or throws a readable Error. */
  async read(text, password) {
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
        throw new Error($t('Wrong password, or the file is damaged.'));
      }
      return this.read(inner);
    }
    if (f.kind !== 'backup' || !Array.isArray(f.plans) || !f.plans.length) {
      throw new Error($t('This backup has no plans in it.'));
    }
    if (+f.v > APP.schema) {
      throw new Error($t('This backup was made by a newer version of ') + APP.name + '.');
    }
    return { plans: f.plans.slice(0, APP.maxPlans).filter(isObj) };
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
