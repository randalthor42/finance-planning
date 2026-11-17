/**
 * @file Google Drive, the little Drive sync needs (REST v3): one file in the app's hidden app data folder, reached
 * with a drive.appdata token. No backend: the browser talks to www.googleapis.com directly. See docs/sync.md.
 *
 * Every call may fail with a DriveError: status 0 (offline: the request never reached Google), 401 (the token is no
 * longer valid: sign in again), 409/412 (the file changed since it was read), 403/429/5xx (try again later).
 */
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
/** The one file, in the app data folder (invisible in the person's Drive, reachable only by this app). */
export const SYNC_FILE = 'runway-sync.json';
const FIELDS = 'id,name,createdTime,modifiedTime,version';

/** Order of sync files: the first one made first; the same moment, by id. */
function byCreation(a, b) {
  if (a.createdTime !== b.createdTime) {
    return a.createdTime < b.createdTime ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export class DriveError extends Error {
  constructor(status, message) {
    super(message || `Google Drive answered ${status}`);
    this.name = 'DriveError';
    this.status = status;
  }
}

/**
 * A client for one token. fetch: injectable (tests); token: () => the current access token.
 * File metadata: { id, modifiedTime, version, etag } (etag when Drive sent one).
 */
export function driveClient({ fetch = globalThis.fetch.bind(globalThis), token }) {
  async function call(url, init = {}) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token()}`, ...(init.headers || {}) } });
    } catch (e) {
      throw new DriveError(0, 'offline');
    }
    if (!res.ok) {
      let message = '';
      try {
        message = (await res.json()).error.message;
      } catch (e) {}
      throw new DriveError(res.status, message);
    }
    return res;
  }
  const meta = async res => ({ ...(await res.json()), etag: res.headers.get('ETag') });
  return {
    /**
     * Every sync file, the first one made first (then by id): the same order on every device. There is one, unless
     * two devices made it at the same moment; Drive sync then merges the others into the first and deletes them.
     */
    async list() {
      const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
      const res = await call(`${API}?spaces=appDataFolder&q=${q}&fields=files(${FIELDS})&pageSize=10`);
      const files = (await res.json()).files || [];
      return files.sort(byCreation);
    },
    /** The sync file's metadata (the first one made), or null when there is none yet. */
    async find() {
      return (await this.list())[0] || null;
    },
    async meta(id) {
      return meta(await call(`${API}/${id}?fields=${FIELDS}`));
    },
    /** The file's text, and its ETag. */
    async read(id) {
      const res = await call(`${API}/${id}?alt=media`);
      return { text: await res.text(), etag: res.headers.get('ETag') };
    },
    async create(text) {
      const boundary = 'runway' + Math.random().toString(36).slice(2);
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
      const res = await call(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return meta(res);
    },
    /** Replaces the file's text; with etag, only if the file is still that version (412 otherwise). */
    async update(id, text, etag) {
      const res = await call(`${UPLOAD}/${id}?uploadType=media&fields=${FIELDS}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
        body: text,
      });
      return meta(res);
    },
    async remove(id) {
      await call(`${API}/${id}`, { method: 'DELETE' });
    },
  };
}
