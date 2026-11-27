import { setDemoRuntime } from '../lib/demo';
import { DemoSocket } from './bus';
import { demoFetch } from './server';
import { startSimulation } from './sim';

/** Registers the fake API and sockets and starts the match simulator. Called once before the app renders. */
export function bootDemo(): void {
  setDemoRuntime({ fetch: demoFetch, socket: (path) => new DemoSocket(path) as unknown as WebSocket });
  startSimulation();
}
