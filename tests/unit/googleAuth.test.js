/**
 * @file Unit tests for Google sign-in (services/googleAuth.js) with a stand-in page and Google library: the script is
 * loaded only when needed, once; a token for the drive.appdata scope only; refusals and failures are told apart.
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_SCOPE, GIS_URL, googleAuth } from '../../src/services/googleAuth.js';

/** A page whose <script> elements "load" Google's library; answer: what the token window gives back. */
function fakePage({ answer = { access_token: 'tok', expires_in: 3599 }, granted = true, fails = false } = {}) {
  const win = { scripts: [], configs: [], requests: [] };
  win.document = {
    createElement: () => ({ remove() {} }),
    head: {
      append(script) {
        win.scripts.push(script.src);
        setTimeout(() => {
          if (fails) {
            return script.onerror();
          }
          win.google = {
            accounts: {
              oauth2: {
                initTokenClient(config) {
                  win.configs.push(config);
                  return {
                    requestAccessToken(options) {
                      win.requests.push(options);
                      setTimeout(() =>
                        answer.error === 'popup_closed'
                          ? config.error_callback({ type: 'popup_closed' })
                          : config.callback(answer),
                      );
                    },
                  };
                },
                hasGrantedAllScopes: () => granted,
              },
            },
          };
          script.onload();
        });
      },
    },
  };
  return win;
}

test('nothing is loaded until a sign-in is asked for; then Google’s script, once', async () => {
  const win = fakePage();
  const auth = googleAuth({ clientId: 'id.apps.googleusercontent.com', win });
  assert.deepEqual(win.scripts, []);
  await Promise.all([auth.load(), auth.load()]);
  assert.deepEqual(win.scripts, [GIS_URL]);
});

test('a token for the app data folder only, with the time it ends', async () => {
  const win = fakePage();
  const auth = googleAuth({ clientId: 'id.apps.googleusercontent.com', win });
  const before = Date.now();
  const token = await auth.signIn({ prompt: 'consent' });
  assert.equal(token.token, 'tok');
  assert.ok(token.expiresAt >= before + 3599_000 && token.expiresAt <= Date.now() + 3599_000);
  assert.equal(win.configs[0].scope, DRIVE_SCOPE, 'drive.appdata, nothing else');
  assert.equal(win.configs[0].client_id, 'id.apps.googleusercontent.com');
  assert.deepEqual(win.requests, [{ prompt: 'consent' }]);
});

test('closing Google’s window, refusing Drive access, or no connection: each rejects with its own type', async () => {
  const closed = googleAuth({ clientId: 'x', win: fakePage({ answer: { error: 'popup_closed' } }) });
  await assert.rejects(closed.signIn(), e => e.type === 'popup_closed');
  const denied = googleAuth({ clientId: 'x', win: fakePage({ answer: { error: 'access_denied' } }) });
  await assert.rejects(denied.signIn(), e => e.type === 'access_denied');
  const scope = googleAuth({ clientId: 'x', win: fakePage({ granted: false }) });
  await assert.rejects(scope.signIn(), e => e.type === 'scope');
  const offline = googleAuth({ clientId: 'x', win: fakePage({ fails: true }) });
  await assert.rejects(offline.signIn(), e => e.type === 'offline');
});
