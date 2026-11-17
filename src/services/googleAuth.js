/**
 * @file Signing in with Google Identity Services (the "token model"): an access token for the drive.appdata scope
 * only, with no backend. The library (accounts.google.com/gsi/client) is loaded only when it is needed, never at
 * start, so the app never waits for the network. See docs/sync.md.
 *
 * Without a backend there is no refresh token: an access token lasts about an hour. After that, Google needs a click
 * to give a new one (a pop-up, which browsers only open from a click), so the status becomes "Sign in again".
 */
/** The only access asked for: the app's own hidden folder in the person's Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Google Identity Services' script, loaded only when a sign-in is needed. */
export const GIS_URL = 'https://accounts.google.com/gsi/client';

/** The error a sign-in rejects with when Google's window closed without an answer (callers: nothing changed). */
const closedError = () => Object.assign(new Error('closed'), { type: 'closed' });

/** A Google sign-in for one client id. win: the page's window (injectable for tests). */
export function googleAuth({ clientId, win = globalThis }) {
  let loading = null;
  let client = null;
  let pending = null;
  /** Loads the library once; rejects (offline, blocked) after 15 s. */
  function load() {
    if (win.google && win.google.accounts && win.google.accounts.oauth2) {
      return Promise.resolve(win.google.accounts.oauth2);
    }
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = win.document.createElement('script');
        script.src = GIS_URL;
        script.async = true;
        const fail = () => {
          loading = null;
          script.remove();
          reject(Object.assign(new Error('Google sign-in could not be loaded'), { type: 'offline' }));
        };
        const timer = setTimeout(fail, 15000);
        script.onload = () => {
          clearTimeout(timer);
          if (win.google && win.google.accounts && win.google.accounts.oauth2) {
            resolve(win.google.accounts.oauth2);
          } else {
            fail();
          }
        };
        script.onerror = () => {
          clearTimeout(timer);
          fail();
        };
        win.document.head.append(script);
      });
    }
    return loading;
  }
  return {
    load,
    /**
     * Asks Google for a token (opens Google's window; call it from a click). prompt: '' lets Google skip the
     * consent screen when it was given before; 'consent' always shows it. Resolves to { token, expiresAt }.
     */
    async signIn({ prompt = '' } = {}) {
      const oauth2 = await load();
      if (!client) {
        client = oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: response => {
            const p = pending;
            pending = null;
            if (!p) {
              return;
            }
            if (response.error || !response.access_token) {
              p.reject(Object.assign(new Error(response.error || 'no token'), { type: response.error || 'denied' }));
            } else if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
              p.reject(Object.assign(new Error('Drive access was not given'), { type: 'scope' }));
            } else {
              p.resolve({
                token: response.access_token,
                expiresAt: Date.now() + (+response.expires_in || 3600) * 1000,
              });
            }
          },
          error_callback: error => {
            const p = pending;
            pending = null;
            if (!p) {
              return;
            }
            if (error.type) {
              p.reject(Object.assign(new Error(error.type), { type: error.type }));
            } else {
              p.reject(closedError());
            }
          },
        });
      }
      return new Promise((resolve, reject) => {
        if (pending) {
          // a second sign-in while Google's window is still open: Google answers only the last request, so the
          // first one is settled now, as closed, instead of waiting forever
          pending.reject(closedError());
        }
        pending = { resolve, reject };
        client.requestAccessToken({ prompt });
      });
    },
  };
}
