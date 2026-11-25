import { useEffect, useRef } from 'react';
import { useFieldState } from '../api/fields';
import { useWsStore } from '../stores/ws';

export interface FieldRow {
  id: string;
  match: string;
  red: string[];
  blue: string[];
  status: 'live' | 'queued' | 'idle';
  statusLabel: string;
}

/** Fields known from live events: current match plus whether it is running. */
export function useFieldRows(): FieldRow[] {
  const currentMatches = useWsStore((s) => s.currentMatches);
  const recent = useWsStore((s) => s.recentEvents);
  return Object.keys(currentMatches)
    .filter((k) => !k.includes('.'))
    .sort()
    .map((id) => {
      const m = currentMatches[id];
      const last = recent.find(
        (e) => String(e.payload.fieldID ?? '') === id && (e.type === 'matchStarted' || e.type === 'matchStopped'),
      );
      const live = last?.type === 'matchStarted';
      const num = m.matchNum !== undefined ? `${String(m.round ?? '').trim()} ${String(m.matchNum)}`.trim() : '';
      return {
        id,
        match: num || 'No match queued',
        red: m.redTeams ?? [],
        blue: m.blueTeams ?? [],
        status: live ? 'live' : num ? 'queued' : 'idle',
        statusLabel: live ? 'In match' : num ? 'Queued' : 'Idle',
      };
    });
}

export function useAnyFieldLive(): boolean {
  return useFieldRows().some((f) => f.status === 'live');
}

/** Loads the server's field snapshot on mount and after each reconnect, so a
 * page opened mid-match shows the fields straight away. */
export function useFieldSeed(): void {
  const connected = useWsStore((s) => s.connected);
  const seedFields = useWsStore((s) => s.seedFields);
  const { data, refetch } = useFieldState();
  useEffect(() => {
    if (data) seedFields(data);
  }, [data, seedFields]);
  const was = useRef(false);
  useEffect(() => {
    if (connected && !was.current) {
      void refetch().then((r) => {
        if (r.data) seedFields(r.data, true);
      });
    }
    was.current = connected;
  }, [connected, refetch, seedFields]);
}
