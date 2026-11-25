import { useEffect, useRef, useState } from 'react';

export type SocketStatus = 'connecting' | 'live' | 'reconnecting';

export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * Plain reconnecting WebSocket for the public / OBS pages. Unlike `useWebSocket`
 * it never touches the admin stores. `path` is a same-origin path including any
 * query string, or null to stay disconnected. `onMessage` receives the parsed
 * JSON frame; `onOpen` runs after every (re)connect.
 */
export function usePublicSocket(
  path: string | null,
  onMessage: (msg: unknown) => void,
  options: { onOpen?: () => void; ping?: boolean } = {},
): { status: SocketStatus; send: (data: unknown) => boolean } {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const handler = useRef(onMessage);
  const openHandler = useRef(options.onOpen);
  const socket = useRef<WebSocket | null>(null);
  handler.current = onMessage;
  openHandler.current = options.onOpen;
  const ping = options.ping ?? false;

  useEffect(() => {
    if (!path) return undefined;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pinger: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}//${window.location.host}${path}`);
      } catch {
        schedule();
        return;
      }
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus('live');
        if (ping) {
          clearInterval(pinger);
          pinger = setInterval(() => {
            try {
              ws.send('ping');
            } catch {
              /* closing */
            }
          }, 25000);
        }
        openHandler.current?.();
      };
      ws.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(ev.data as string));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        clearInterval(pinger);
        if (closed) return;
        setStatus('reconnecting');
        schedule();
      };
    }

    function schedule() {
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      attempt += 1;
      retry = setTimeout(connect, delay);
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(pinger);
      socket.current?.close();
      socket.current = null;
    };
  }, [path, ping]);

  const send = (data: unknown): boolean => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    return true;
  };
  return { status, send };
}
