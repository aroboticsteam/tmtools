import type { RequestOptions } from './http';

/**
 * The GitHub Pages demo (`VITE_DEMO=true`, see `frontend/src/demo/`): the SPA runs against an in-browser fake
 * API and event simulator instead of a backend. The flag is replaced at build time, so a normal build carries
 * none of the demo code paths; the demo modules are loaded (and registered here) only when the flag is set.
 */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

export interface DemoRuntime {
  fetch<T>(path: string, options: RequestOptions): Promise<T>;
  socket(path: string): WebSocket;
}

let runtime: DemoRuntime | null = null;
export const setDemoRuntime = (r: DemoRuntime): void => {
  runtime = r;
};
export const demoRuntime = (): DemoRuntime | null => (DEMO ? runtime : null);
