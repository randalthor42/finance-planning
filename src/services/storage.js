/**
 * @file Persistence adapter. Swap this class for an HTTP adapter to store plans on a server.
 */
/** The only code that knows where data lives. Swap this class to change storage. */
export class LocalStorageAdapter {
  constructor(key) {
    this.key = key;
  }
  read() {
    try {
      return JSON.parse(localStorage.getItem(this.key));
    } catch (e) {
      return null;
    }
  }
  write(db) {
    try {
      localStorage.setItem(this.key, JSON.stringify(db));
      return true;
    } catch (e) {
      return false;
    }
  }
}
