import { describe, expect, it } from 'vitest';
import { parseCsv, parsePitCsv } from './csv';

describe('csv', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  });
  it('reads pit assignments with or without a header', () => {
    expect(parsePitCsv('Team Number,Pit\n1234A, A1\n5678B,B2\n')).toEqual([
      { team: '1234A', pit: 'A1' },
      { team: '5678B', pit: 'B2' },
    ]);
    expect(parsePitCsv('1234A,A1')).toEqual([{ team: '1234A', pit: 'A1' }]);
  });
  it('skips rows missing a pit', () => {
    expect(parsePitCsv('team,pit\n1234A,\n')).toEqual([]);
  });
});
