/** The demo's event bus and fake sockets. Events go straight into the admin store; public pages get frames over fake sockets. */
import { useWsStore } from '../stores/ws';
import type { EventBusMessage } from '../types/api';

type Listener = (m: EventBusMessage) => void;
const listeners = new Set<Listener>();
export const onEvent = (l: Listener): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export interface FieldEventRow {
  type: string;
  entity_id: string;
  timestamp: number;
  display?: string;
}
export const fieldEvents: Record<string, FieldEventRow[]> = {};
export const audience: Record<string, { display: string; timestamp: number }> = {};

export function emit(type: string, entity_id: string, payload: Record<string, unknown> = {}, tags: string[] = []): EventBusMessage {
  const msg: EventBusMessage = { entity_id, entity_tags: tags, type, timestamp: Date.now() / 1000, payload };
  useWsStore.getState().dispatch(msg);
  const fid = payload.fieldID;
  if (fid !== undefined && fid !== null) {
    const rows = (fieldEvents[String(fid)] ??= []);
    const display = typeof payload.display === 'string' ? payload.display : undefined;
    rows.unshift({ type, entity_id, timestamp: msg.timestamp, ...(display ? { display } : {}) });
    rows.length = Math.min(rows.length, 8);
  }
  if (type === 'audienceDisplayChanged' && typeof payload.display === 'string') {
    audience[entity_id] = { display: payload.display, timestamp: msg.timestamp };
  }
  for (const l of [...listeners]) l(msg);
  return msg;
}

// ── public sockets ────────────────────────────────────────────────────────

export type SocketKind = 'events' | 'overlay' | 'prompter' | 'room' | 'replay';

interface Sub {
  kind: SocketKind;
  id: string;
  deliver: (msg: unknown) => void;
}
const subs = new Set<Sub>();

type ClientHandler = (kind: SocketKind, id: string, data: unknown) => void;
type OpenHandler = (kind: SocketKind, id: string, deliver: (msg: unknown) => void) => void;
let onClientFrame: ClientHandler = () => undefined;
let onSocketOpen: OpenHandler = () => undefined;
export function setSocketHandlers(open: OpenHandler, frame: ClientHandler): void {
  onSocketOpen = open;
  onClientFrame = frame;
}

let channel: BroadcastChannel | null | undefined;
function relay(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = new BroadcastChannel('tmtools-demo');
    channel.onmessage = (ev) => {
      const d = ev.data as { t: string; kind?: SocketKind; id?: string; msg?: unknown; payload?: Record<string, unknown> };
      if (d.t === 'frame' && d.kind) publish(d.kind, d.id ?? null, d.msg, false);
      if (d.t === 'status' && d.id) emit('replay_status', d.id, d.payload ?? {});
    };
  } catch {
    channel = null;
  }
  return channel;
}

/** Deliver a frame to every open fake socket of a kind (id null = all). Replay frames are relayed to other tabs (the player page). */
export function publish(kind: SocketKind, id: string | null, msg: unknown, share = true): void {
  for (const s of [...subs]) if (s.kind === kind && (id === null || s.id === id)) s.deliver(msg);
  if (share && kind === 'replay') relay()?.postMessage({ t: 'frame', kind, id, msg });
}

/** A replay player in this tab reports its position: show it here and tell other tabs (the analysis desk). */
export function reportReplayStatus(id: string, payload: Record<string, unknown>): void {
  emit('replay_status', id, payload);
  relay()?.postMessage({ t: 'status', id, payload });
}

export function startRelay(): void {
  relay();
}

export class DemoSocket {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private sub: Sub;
  private kind: SocketKind;
  private id: string;

  constructor(path: string) {
    const m = /^\/ws\/([a-z]+)(?:\/([^?]+))?/.exec(path);
    this.kind = (m?.[1] ?? 'events') as SocketKind;
    this.id = decodeURIComponent(m?.[2] ?? '');
    this.sub = {
      kind: this.kind,
      id: this.id,
      deliver: (msg) => {
        if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) });
      },
    };
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      subs.add(this.sub);
      this.onopen?.({});
      onSocketOpen(this.kind, this.id, this.sub.deliver);
    }, 0);
  }

  send(data: unknown): void {
    if (this.readyState !== 1 || data === 'ping') return;
    let parsed: unknown = data;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
    }
    onClientFrame(this.kind, this.id, parsed);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    subs.delete(this.sub);
    setTimeout(() => this.onclose?.({}), 0);
  }
}
