import { beforeEach, describe, expect, it } from 'vitest';
import { useWsStore } from './ws';
import type { EventBusMessage, FieldStateSnapshot } from '../types/api';

const initial = useWsStore.getState();

const live = (type: string, fieldID: number, extra: Record<string, unknown> = {}): EventBusMessage => ({
  entity_id: 'vex_tm.main',
  entity_tags: [],
  type,
  timestamp: 5000,
  payload: { fieldID, ...extra },
});

const snapshot: FieldStateSnapshot = {
  matches: {
    '1': { type: 'fieldMatchAssigned', entity_id: 'vex_tm.main', timestamp: 100, payload: { fieldID: 1, matchNum: 4, redTeams: ['1A'], blueTeams: ['2B'] } },
    '2': { type: 'fieldMatchAssigned', entity_id: 'vex_tm.main', timestamp: 101, payload: { fieldID: 2, matchNum: 5 } },
  },
  events: {
    '1': [
      { type: 'matchStopped', entity_id: 'vex_tm.main', timestamp: 120 },
      { type: 'matchStarted', entity_id: 'vex_tm.main', timestamp: 110 },
    ],
  },
};

beforeEach(() => useWsStore.setState({ ...initial, currentMatches: {}, recentEvents: [] }, true));

describe('seedFields', () => {
  it('shows fields a freshly loaded page has never heard about', () => {
    useWsStore.getState().seedFields(snapshot);
    const s = useWsStore.getState();
    expect(Object.keys(s.currentMatches).sort()).toEqual(['1', '2']);
    expect(s.currentMatches['1'].redTeams).toEqual(['1A']);
    expect(s.recentEvents.map((e) => e.type)).toEqual(['matchStopped', 'matchStarted']);
    expect(s.recentEvents.every((e) => e.payload.fieldID === '1')).toBe(true);
  });

  it('keeps what live events already said (they are newer than the snapshot)', () => {
    useWsStore.getState().dispatch(live('fieldMatchAssigned', 1, { matchNum: 9 }));
    useWsStore.getState().seedFields(snapshot);
    const s = useWsStore.getState();
    expect(s.currentMatches['1'].matchNum).toBe(9);
    expect(s.currentMatches['2'].matchNum).toBe(5); // the field with no live event is still filled in
    expect(s.recentEvents.filter((e) => e.payload.fieldID === 1 || e.payload.fieldID === '1').map((e) => e.type)).toEqual([
      'fieldMatchAssigned',
    ]);
  });

  it('replaces live state after a reconnect, when events may have been missed', () => {
    useWsStore.getState().dispatch(live('fieldMatchAssigned', 1, { matchNum: 9 }));
    useWsStore.getState().seedFields(snapshot, true);
    const s = useWsStore.getState();
    expect(s.currentMatches['1'].matchNum).toBe(4);
    expect(s.recentEvents.map((e) => e.type)).toEqual(['matchStopped', 'matchStarted']);
  });

  it('is a no-op for an empty or partial snapshot and caps the event list at 50', () => {
    useWsStore.getState().seedFields({ matches: {}, events: {} });
    expect(useWsStore.getState().currentMatches).toEqual({});
    useWsStore.getState().seedFields({ events: {} } as unknown as FieldStateSnapshot);
    const many = Array.from({ length: 80 }, (_, i) => ({ type: 'x', entity_id: 'e', timestamp: i }));
    useWsStore.getState().seedFields({ matches: {}, events: { '3': many } });
    expect(useWsStore.getState().recentEvents).toHaveLength(50);
  });

  it('later live events still update seeded fields', () => {
    useWsStore.getState().seedFields(snapshot);
    useWsStore.getState().dispatch(live('fieldMatchAssigned', 2, { matchNum: 6 }));
    expect(useWsStore.getState().currentMatches['2'].matchNum).toBe(6);
  });
});
