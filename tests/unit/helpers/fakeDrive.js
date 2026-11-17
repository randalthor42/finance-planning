/**
 * @file A fake Google Drive (REST v3, the calls services/drive.js makes), as a `fetch` function. Shared by two
 * "devices" it is one Google account's app data folder. Used by the unit tests and, through Playwright's network
 * routing, by the browser test (tests/regression/drive.ui.cjs).
 *
 * Emulated: list in appDataFolder, download (alt=media, with an ETag), metadata, multipart create, media update
 * (If-Match → 412 when stale), delete; Bearer tokens (401 when unknown or expired); going offline (fetch rejects).
 */
export class FakeDrive {
  constructor() {
    this.files = new Map();
    this.tokens = new Set();
    this.offline = false;
    this.clock = Date.UTC(2026, 10, 1, 9);
    this.calls = [];
    this.seq = 0;
    /** Runs just before an update is applied (a test can let "another device" write first). */
    this.beforeUpdate = null;
    /** Updates refused because the file had changed (If-Match). */
    this.refused = 0;
    /** Like Drive may: If-Match on an upload is not checked (the last write wins). */
    this.ignoreIfMatch = false;
    this.fetch = this.fetch.bind(this);
  }
  /** A token the fake accepts, as Google Identity Services would give. */
  grant(token = 'token-' + ++this.seq) {
    this.tokens.add(token);
    return token;
  }
  expire(token) {
    this.tokens.delete(token);
  }
  tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  meta(f) {
    return {
      id: f.id,
      name: f.name,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      version: String(f.version),
    };
  }
  etag(f) {
    return `"v${f.version}"`;
  }
  /** Writes as another device would (directly, as Drive stores it). */
  write(id, content) {
    const f = this.files.get(id);
    f.content = content;
    f.version++;
    f.modifiedTime = this.tick();
  }
  file(name = 'runway-sync.json') {
    return [...this.files.values()].find(f => f.name === name) || null;
  }
  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    // 'GET /drive/v3/files/<id>' (metadata), '…?alt=media' (content), 'PATCH /upload/…?uploadType=media'
    const kind = u.searchParams.get('alt')
      ? 'alt=' + u.searchParams.get('alt')
      : u.searchParams.get('uploadType')
        ? 'uploadType=' + u.searchParams.get('uploadType')
        : '';
    this.calls.push(`${method} ${u.pathname}${kind ? '?' + kind : ''}`);
    if (this.offline) {
      throw new TypeError('Failed to fetch');
    }
    const headers = new Headers(init.headers || {});
    const token = (headers.get('Authorization') || '').replace(/^Bearer /, '');
    const json = (status, body, extra = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });
    if (!this.tokens.has(token)) {
      return json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
    }
    const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m) {
      return json(404, { error: { code: 404, message: 'Not found' } });
    }
    const [, upload, id] = m;
    if (method === 'GET' && !id) {
      const q = u.searchParams.get('q') || '';
      const name = (/name\s*=\s*'([^']+)'/.exec(q) || [])[1];
      if (u.searchParams.get('spaces') !== 'appDataFolder') {
        return json(403, { error: { code: 403, message: 'The granted scopes do not allow use of this space.' } });
      }
      return json(200, {
        files: [...this.files.values()].filter(f => !name || f.name === name).map(f => this.meta(f)),
      });
    }
    const f = id ? this.files.get(id) : null;
    if (id && !f) {
      return json(404, { error: { code: 404, message: 'File not found: ' + id } });
    }
    if (method === 'GET' && u.searchParams.get('alt') === 'media') {
      return new Response(f.content, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: this.etag(f) },
      });
    }
    if (method === 'GET') {
      return json(200, this.meta(f), { ETag: this.etag(f) });
    }
    if (method === 'POST' && upload) {
      const body = String(init.body);
      const boundary = /boundary=([^;]+)/.exec(headers.get('Content-Type') || '')[1];
      const parts = body
        .split('--' + boundary)
        .slice(1, -1)
        .map(p => p.replace(/^\r\n/, '').split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const meta = JSON.parse(parts[0]);
      if (!(meta.parents || []).includes('appDataFolder')) {
        return json(403, { error: { code: 403, message: 'Only the app data folder is allowed.' } });
      }
      const created = {
        id: 'file' + ++this.seq,
        name: meta.name,
        content: parts[1],
        version: 1,
        modifiedTime: this.tick(),
      };
      created.createdTime = created.modifiedTime;
      this.files.set(created.id, created);
      return json(200, this.meta(created), { ETag: this.etag(created) });
    }
    if (method === 'PATCH' && upload) {
      if (this.beforeUpdate) {
        const hook = this.beforeUpdate;
        this.beforeUpdate = null;
        await hook(f);
      }
      const match = this.ignoreIfMatch ? null : headers.get('If-Match');
      if (match && match !== this.etag(f)) {
        this.refused++;
        return json(412, { error: { code: 412, message: 'Precondition Failed' } });
      }
      this.write(f.id, String(init.body));
      return json(200, this.meta(f), { ETag: this.etag(f) });
    }
    if (method === 'DELETE') {
      this.files.delete(f.id);
      return new Response(null, { status: 204 });
    }
    return json(400, { error: { code: 400, message: 'Bad request' } });
  }
}

/** A Google Identity Services stand-in: hands out the fake Drive's tokens. */
export function fakeAuth(drive) {
  const auth = {
    signIns: 0,
    refuse: false,
    async signIn() {
      if (auth.refuse) {
        throw Object.assign(new Error('popup_closed'), { type: 'popup_closed' });
      }
      auth.signIns++;
      return { token: drive.grant(), expiresAt: drive.clock + 3600_000 };
    },
  };
  return auth;
}
