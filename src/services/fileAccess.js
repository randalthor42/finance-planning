/**
 * @file The File System Access API, reduced to what the data file needs. The person picks one file; the app gets a
 * handle to that file only (never a folder), so it cannot see or touch anything else on the computer.
 * A handle from the Origin Private File System has the same methods, so the mobile storage can reuse this later.
 */
import { $t } from '../core/i18n.js';

const types = () => [{ description: $t('Runway data'), accept: { 'application/json': ['.json'] } }];
/** The pickers remember the last folder under this id, apart from other sites and from backups. */
const PICKER_ID = 'runway-data';

export const FileAccess = {
  /** Chrome, Edge and Opera on a computer. Not Firefox or Safari, and not on phones. */
  supported: () =>
    typeof globalThis.showSaveFilePicker === 'function' && typeof globalThis.showOpenFilePicker === 'function',
  /** Asks where to save a new file (needs a click). Rejects with an AbortError when the person cancels. */
  pickNew(suggestedName) {
    return globalThis.showSaveFilePicker({
      id: PICKER_ID,
      suggestedName,
      types: types(),
      excludeAcceptAllOption: true,
    });
  },
  /** Asks for an existing file (needs a click). */
  async pickExisting() {
    const [handle] = await globalThis.showOpenFilePicker({
      id: PICKER_ID,
      types: types(),
      excludeAcceptAllOption: true,
      multiple: false,
    });
    return handle;
  },
  /** 'granted', 'prompt' or 'denied'. With ask, the browser asks the person (only from a click). */
  async permission(handle, ask) {
    if (typeof handle.queryPermission !== 'function') {
      return 'granted';
    }
    const mode = { mode: 'readwrite' };
    let state = await handle.queryPermission(mode);
    if (state !== 'granted' && ask && typeof handle.requestPermission === 'function') {
      state = await handle.requestPermission(mode);
    }
    return state;
  },
  /** When the file last changed and its size: enough to notice that another device saved it, without reading it. */
  async stat(handle) {
    const file = await handle.getFile();
    return { modified: file.lastModified, size: file.size };
  },
  async read(handle) {
    const file = await handle.getFile();
    return { text: await file.text(), modified: file.lastModified, size: file.size };
  },
  /**
   * Replaces the file's content. The browser writes to a temporary file and swaps it in on close, so a reader (a
   * sync client, another device) never sees half a file. Returns the new stat.
   */
  async write(handle, text) {
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (e) {
      try {
        await writable.abort();
      } catch (x) {}
      throw e;
    }
    return this.stat(handle);
  },
};
