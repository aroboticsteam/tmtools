import { useEffect, useRef } from 'react';
import { useFieldState } from '../api/fields';
import { useWsStore } from '../stores/ws';

export interface FieldRow {
  id: string;
  match: string;
  red: string[];
  blue: string[];
  status: 'live' | 'countdown' | 'queued' | 'idle';
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
      // Newest event wins: the audience display going to IN_MATCH is the countdown, matchStarted is the
      // match itself, and a stop or any other display ends both.
      const last = recent.find(
        (e) =>
          String(e.payload.fieldID ?? '') === id &&
          (e.type === 'matchStarted' || e.type === 'matchStopped' || e.type === 'audienceDisplayChanged'),
      );
      const live = last?.type === 'matchStarted';
      const countdown = last?.type === 'audienceDisplayChanged' && String(last.payload.display ?? '') === 'IN_MATCH';
      const num = m.matchNum !== undefined ? `${String(m.round ?? '').trim()} ${String(m.matchNum)}`.trim() : '';
      return {
        id,
        match: num || 'No match queued',
        red: m.redTeams ?? [],
        blue: m.blueTeams ?? [],
        status: live ? 'live' : countdown ? 'countdown' : num ? 'queued' : 'idle',
        statusLabel: live ? 'In match' : countdown ? 'Countdown' : num ? 'Queued' : 'Idle',
      };
    });
}

export function useAnyFieldLive(): boolean {
  return useFieldRows().some((f) => f.status === 'live');
}

/** Loads the server's field snapshot on mount and after each reconnect, so a
 * page opened mid-match shows the fields straight away. */
export function useFieldSeed(enabled = true): void {
  const connected = useWsStore((s) => s.connected);
  const seedFields = useWsStore((s) => s.seedFields);
  const { data, refetch } = useFieldState(enabled);
  useEffect(() => {
    if (data) seedFields(data);
  }, [data, seedFields]);
  const was = useRef(false);
  useEffect(() => {
    if (enabled && connected && !was.current) {
      void refetch().then((r) => {
        if (r.data) seedFields(r.data, true);
      });
    }
    was.current = connected;
  }, [enabled, connected, refetch, seedFields]);
}
