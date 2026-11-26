import { vi } from 'vitest';

/** Replaces WebSocket with a recorder so a test can push frames into a page. */
export class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose = null;
  }
  deliver(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

export function installFakeSocket(): void {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
}

export function lastSocket(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1];
}
