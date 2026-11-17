/**
 * @file Test doubles for the File System Access API, IndexedDB handle storage and localStorage, for Node.
 * A FakeDisk is shared by several "devices", like a file in a synced folder (OneDrive, Dropbox, Syncthing).
 */

const domError = name => Object.assign(new Error(name), { name });

export class FakeDisk {
  constructor() {
    this.files = new Map();
    this.clock = 1_700_000_000_000;
  }
  /** Every write gets a later modification time, like a real file system. */
  tick() {
    this.clock += 1000;
    return this.clock;
  }
  text(name) {
    const file = this.files.get(name);
    return file ? file.text : undefined;
  }
  json(name) {
    return JSON.parse(this.text(name));
  }
  /** Another program (or the sync client bringing another device's version) writes the file. */
  write(name, text) {
    this.files.set(name, { text, modified: this.tick() });
  }
  remove(name) {
    this.files.delete(name);
  }
}

/** A FileSystemFileHandle look-alike. permission: 'granted' | 'prompt' | 'denied'. */
export function fakeHandle(disk, name, { permission = 'granted', grant = true } = {}) {
  const handle = {
    kind: 'file',
    name,
    permission,
    grant,
    writes: 0,
    reads: 0,
    stats: 0,
    async queryPermission() {
      return handle.permission;
    },
    async requestPermission() {
      if (handle.grant) {
        handle.permission = 'granted';
      }
      return handle.permission;
    },
    async getFile() {
      if (handle.permission !== 'granted') {
        throw domError('NotAllowedError');
      }
      const file = disk.files.get(name);
      if (!file) {
        throw domError('NotFoundError');
      }
      handle.stats++;
      return {
        name,
        lastModified: file.modified,
        size: file.text.length,
        text: async () => {
          handle.reads++;
          return file.text;
        },
      };
    },
    async createWritable() {
      if (handle.permission !== 'granted') {
        throw domError('NotAllowedError');
      }
      if (!disk.files.has(name)) {
        throw domError('NotFoundError');
      }
      let buffer = '';
      return {
        write: async text => {
          buffer += text;
        },
        close: async () => {
          disk.write(name, buffer);
          handle.writes++;
        },
        abort: async () => {},
      };
    },
  };
  return handle;
}

/** What a save picker does: the chosen file exists (empty when it is new) and its handle comes back. */
export function pickerFor(disk, name, options) {
  return async () => {
    if (!disk.files.has(name)) {
      disk.write(name, '');
    }
    return fakeHandle(disk, name, options);
  };
}

/** showSaveFilePicker / showOpenFilePicker on globalThis for the duration of a test. */
export function installPickers({ save, open } = {}) {
  globalThis.showSaveFilePicker = save || (async () => Promise.reject(domError('AbortError')));
  globalThis.showOpenFilePicker = async options => [
    await (open || (async () => Promise.reject(domError('AbortError'))))(options),
  ];
  return () => {
    delete globalThis.showSaveFilePicker;
    delete globalThis.showOpenFilePicker;
  };
}

export const cancelled = async () => Promise.reject(domError('AbortError'));

/** The IndexedDB handle store, in memory. */
export function memoryKeep() {
  const map = new Map();
  return {
    map,
    get: async key => map.get(key),
    set: async (key, value) => void map.set(key, value),
    del: async key => void map.delete(key),
  };
}

/** The small per-browser record of the last sync (localStorage in the app). */
export function memoryMeta() {
  let value = null;
  return {
    load: () => (value ? JSON.parse(value) : null),
    save: v => {
      value = JSON.stringify(v);
    },
  };
}

/** The localStorage adapter of one browser, in memory. */
export function memoryAdapter(initial = null) {
  return {
    key: 'runway.db.v1',
    text: initial ? JSON.stringify(initial) : null,
    writes: 0,
    read() {
      return this.text ? JSON.parse(this.text) : null;
    },
    readText() {
      return this.text;
    },
    write(db, text) {
      this.text = text === undefined ? JSON.stringify(db) : text;
      this.writes++;
      return true;
    },
  };
}
