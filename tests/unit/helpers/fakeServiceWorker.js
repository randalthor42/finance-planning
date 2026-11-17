/**
 * @file Runs the generated service worker (build/pwa.js) in Node, in a fake worker: its own global with
 * addEventListener, caches, clients, registration and fetch. Events are dispatched like the browser does.
 */
import vm from 'node:vm';

export const SCOPE = 'https://example.org/runway/';

class FakeCache {
  constructor() {
    this.map = new Map();
  }
  key(request, ignoreSearch) {
    const url = new URL(typeof request === 'string' ? request : request.url);
    url.hash = '';
    if (ignoreSearch) {
      url.search = '';
    }
    return url.href;
  }
  async match(request, options = {}) {
    if (options.ignoreSearch) {
      const wanted = this.key(request, true);
      for (const [k, v] of this.map) {
        if (this.key(k, true) === wanted) {
          return v.clone();
        }
      }
      return undefined;
    }
    const hit = this.map.get(this.key(request));
    return hit && hit.clone();
  }
  async put(request, response) {
    this.map.set(this.key(request), response);
  }
}

/** A network: url → [status, body]; offline: every fetch fails. */
export function fakeNetwork(pages = {}) {
  const net = {
    pages,
    offline: false,
    calls: [],
    fetch: async request => {
      const url = typeof request === 'string' ? request : request.url;
      net.calls.push(url);
      if (net.offline) {
        throw new TypeError('Failed to fetch');
      }
      const key = new URL(url);
      key.hash = '';
      const [status, body] = net.pages[key.href] || net.pages[key.origin + key.pathname] || [404, 'not found'];
      const response = new Response(body, { status });
      Object.defineProperty(response, 'type', { value: 'basic' });
      return response;
    },
  };
  return net;
}

/** Loads the worker's source; returns its global and helpers to dispatch install, activate and fetch. */
export function loadWorker(source, { network = fakeNetwork(), clientUrls = [SCOPE + 'index.html'], caches } = {}) {
  const handlers = {};
  const stores = caches || new Map();
  const state = { skipped: false, claimed: false };
  const cacheStorage = {
    stores,
    open: async name => {
      if (!stores.has(name)) {
        stores.set(name, new FakeCache());
      }
      return stores.get(name);
    },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
  };
  const self = {
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    registration: { scope: SCOPE },
    location: new URL(SCOPE + 'sw.js'),
    clients: {
      matchAll: async () => clientUrls.map(url => ({ url, type: 'window' })),
      claim: async () => {
        state.claimed = true;
      },
    },
    skipWaiting: async () => {
      state.skipped = true;
    },
  };
  const context = vm.createContext({
    self,
    caches: cacheStorage,
    fetch: (...a) => network.fetch(...a),
    Request,
    Response,
    URL,
    Promise,
    Set,
    console,
  });
  context.location = self.location;
  vm.runInContext(source, context);

  /** Dispatches an extendable event; resolves when everything it waits for is done. */
  async function extendable(type, extra = {}) {
    const waits = [];
    let responded = null;
    const event = {
      ...extra,
      waitUntil: p => waits.push(p),
      respondWith: p => {
        responded = Promise.resolve(p);
      },
    };
    handlers[type](event);
    const response = responded ? await responded : undefined;
    await Promise.all(waits);
    return { response, responded: !!responded, waits };
  }
  return {
    self,
    state,
    caches: cacheStorage,
    network,
    handlers,
    install: () => extendable('install'),
    activate: () => extendable('activate'),
    /** A request from the page. mode 'navigate' for loading a page. */
    fetch: (url, init = {}) => {
      const request = new Request(url, { method: init.method || 'GET' });
      Object.defineProperty(request, 'mode', { value: init.mode || 'navigate' });
      return extendable('fetch', { request });
    },
  };
}
