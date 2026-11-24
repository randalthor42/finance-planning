/**
 * @file Loads the simulation (src/logic/sim) the first time it is needed, and only then: it is not part of the code
 * that runs when the app starts. In the built file its code waits in the page as inert text (vite.config.js
 * lazySimulation) and is run here as an inline script; in development it is an ordinary import. Nothing is fetched:
 * the app stays fully offline.
 */
let loading = null;

/**
 * The simulation module (logic/sim/index.js), loaded once.
 * @returns {Promise<object>} the module (the same promise every time)
 */
export function loadSimulation() {
  if (!loading) {
    loading = load().catch(error => {
      loading = null; // a failed load can be tried again
      throw error;
    });
  }
  return loading;
}

async function load() {
  if (import.meta.env.DEV) {
    return import('../logic/sim/index.js');
  }
  if (globalThis.RunwaySim) {
    return globalThis.RunwaySim;
  }
  const source = document.getElementById('runway-sim');
  if (!source) {
    throw new Error('The simulation is missing from this file.');
  }
  const script = document.createElement('script');
  script.textContent = source.textContent;
  document.head.append(script); // an inline script runs at once, before append returns
  script.remove();
  if (!globalThis.RunwaySim) {
    throw new Error('The simulation could not be started.');
  }
  return globalThis.RunwaySim;
}
