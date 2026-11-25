import { describe, expect, it } from 'vitest';
import { orderRecordings, pendingFromFields } from './analysis';

describe('pendingFromFields', () => {
  const matches = {
    '1': { matchNum: 4, round: 'QUAL', redTeams: ['1A'], blueTeams: ['2B'] },
    '2': { matchNum: 5, round: 'QUAL', redTeams: ['3C'], blueTeams: ['4D'] },
    'vex_tm.main': { matchNum: 99, round: 'QUAL' }, // upcoming_match entries are keyed by entity id, not a field
    '3': {}, // a field with its queue cleared
  };

  it('turns each field assignment without a recording into a QUEUED entry', () => {
    const list = pendingFromFields(matches, [{ match_type: 'QUAL', match_number: '4' }]);
    expect(list.map((r) => [r.match_number, r.status, r.teams])).toEqual([['5', 'QUEUED', ['3C', '4D']]]);
  });

  it('sorts after real recordings and by match number', () => {
    const real = { id: 'r', match_key: 'k', match_type: 'QUAL', match_number: '3', teams: [], alliances: null, status: 'READY', started_at: '2026-11-25T15:00:00', stopped_at: null, duration_s: 1, size_bytes: 1, error: null, moments: [] };
    const ordered = orderRecordings([...pendingFromFields(matches, []), real]);
    expect(ordered.map((r) => r.match_number)).toEqual(['3', '4', '5']);
  });
});
