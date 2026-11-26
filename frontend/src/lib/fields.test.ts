import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFieldRows } from './fields';
import { useWsStore } from '../stores/ws';
import type { EventBusMessage } from '../types/api';

const ev = (type: string, payload: Record<string, unknown>, t: number): EventBusMessage => ({
  entity_id: 'vex_tm.main',
  entity_tags: [],
  type,
  timestamp: t,
  payload: { fieldID: 1, ...payload },
});

function status(events: EventBusMessage[]) {
  useWsStore.setState({
    currentMatches: { '1': { round: 'Q', matchNum: 5, redTeams: [], blueTeams: [] } as never },
    recentEvents: events.slice().reverse(),
  });
  return renderHook(() => useFieldRows()).result.current[0]!.statusLabel;
}

describe('field status', () => {
  beforeEach(() => useWsStore.setState({ currentMatches: {}, recentEvents: [] }));

  it('is Countdown when the audience display goes to IN_MATCH', () => {
    expect(status([ev('audienceDisplayChanged', { display: 'IN_MATCH' }, 1)])).toBe('Countdown');
  });

  it('is In match once matchStarted fires after the countdown', () => {
    expect(status([ev('audienceDisplayChanged', { display: 'IN_MATCH' }, 1), ev('matchStarted', {}, 2)])).toBe('In match');
  });

  it('goes back to Queued after the match stops or the display changes', () => {
    expect(status([ev('matchStarted', {}, 1), ev('matchStopped', {}, 2)])).toBe('Queued');
    expect(status([ev('audienceDisplayChanged', { display: 'IN_MATCH' }, 1), ev('audienceDisplayChanged', { display: 'LOGO' }, 2)])).toBe('Queued');
  });
});
