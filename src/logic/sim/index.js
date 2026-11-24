/**
 * @file The simulation, as one module: what the page loads when Forecast › Simulation is opened
 * (services/lazySim.js). In the built file it is kept out of the app's start-up code and run only when asked for
 * (vite.config.js lazySimulation). Everything here is pure: plan and projection in, numbers out.
 */
export { FALLBACK, INCOME_FALLBACK, MIN_MONTHS, WINDOW_MAX, fitModel } from './fit.js';
export { baseFlows } from './baseline.js';
export { drawSpending, effectiveModel, simulate, simulateInChunks } from './engine.js';
export { backtest, verdictOf } from './backtest.js';
export { risksOf } from './risks.js';
export { describe, mad, median, quantile } from './stats.js';
