import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bannerText, flagFor } from '../lib/overlayEngine';
import { OverlayPage } from './OverlayPage';
import { installFakeSocket, lastSocket } from './testSocket';

const FEED = {
  show_robot_name: false,
  teams: {
    '1A': { team_name: 'Alpha', country: 'United Kingdom', bot_url: 'http://x/1a.png', team_url: 'http://x/1a-team.png' },
    '2B': { team_name: 'Bravo', country: 'Turkey' },
    '3C': { team_name: 'Charlie', country: 'Canada' },
    '4D': { team_name: 'Delta', country: 'Narnia' },
  },
};

beforeEach(() => {
  installFakeSocket();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(FEED) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function load() {
  render(
    <MemoryRouter initialEntries={['/overlay/test']}>
      <Routes>
        <Route path="/overlay/:entityId" element={<OverlayPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const grid = document.getElementById('grid')!;
  const send = async (msg: unknown) => {
    await act(async () => {
      lastSocket().deliver(msg);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  return { grid, send };
}

describe('overlay helpers', () => {
  it('formats the match banner', () => {
    expect(bannerText({ round: 'QUAL', matchNum: 191 })).toBe('Q 191');
    expect(bannerText({ round: 'SF', matchNum: 2 })).toBe('SF 2');
    expect(bannerText({})).toBe('');
  });
  it('maps countries to ISO codes', () => {
    expect(flagFor('United Kingdom')).toBe('GB');
    expect(flagFor('Türkiye')).toBe('TR');
    expect(flagFor('Narnia')).toBe('');
  });
});

describe('overlay page layouts (#13)', () => {
  const match = (timestamp?: number, extra = {}) => ({
    type: 'upcoming_match', ...(timestamp ? { timestamp } : {}), payload: { round: 'QUAL', matchNum: 7, redTeams: ['1A', '2B'], blueTeams: ['3C', '4D'], ...extra },
  });

  it('renders VRC as 2x2 with VS, red left and blue right', async () => {
    const { grid, send } = load();
    await send(match());
    expect(grid.classList.contains('mode-vrc')).toBe(true);
    expect(grid.querySelectorAll('.cell')).toHaveLength(4);
    expect(grid.querySelectorAll('.cell.right .panel.blue')).toHaveLength(2);
    expect(grid.querySelectorAll('.cell:not(.right) .panel.red')).toHaveLength(2);
    expect(grid.querySelector('.vs')?.textContent).toBe('VS');
    expect(grid.querySelector('.banner')?.textContent).toBe('Q 7');
    expect(grid.querySelectorAll('.flag')).toHaveLength(3); // Narnia has no flag
    expect(grid.querySelector('img')?.getAttribute('src')).toBe('http://x/1a.png');
  });

  it('renders IQ as two light-blue cells with no VS', async () => {
    const { grid, send } = load();
    await send(match(undefined, { matchNum: 42, redTeams: ['1A'], blueTeams: ['2B'] }));
    expect(grid.classList.contains('mode-iq')).toBe(true);
    expect(grid.querySelectorAll('.cell.iq')).toHaveLength(2);
    expect(grid.querySelectorAll('.panel.red')).toHaveLength(0);
    expect(grid.querySelector('.vs')).toBeNull();
  });

  it('renders the single-team spotlight with bot, label bar and team photo', async () => {
    const { grid, send } = load();
    await send({ type: 'show_team', payload: { team: '1A' } });
    expect(grid.classList.contains('mode-finals')).toBe(true);
    expect(grid.querySelector('.bar .number')?.textContent).toBe('1A');
    expect(grid.querySelector('.bar .name')?.textContent).toBe('Alpha');
    expect(grid.querySelector('.bar .flag')).not.toBeNull();
    expect(grid.querySelector('.teamvid img')?.getAttribute('src')).toBe('http://x/1a-team.png');
  });

  it('is fully empty until something arrives', () => {
    const { grid } = load();
    expect(grid.children).toHaveLength(0);
    expect(grid.classList.contains('visible')).toBe(false);
  });
});

describe('overlay state after a reload (replayed snapshot)', () => {
  const spot = (team: string | null, timestamp: number) => ({ type: 'show_team', timestamp, payload: { team } });
  const iq = (timestamp: number) => ({
    type: 'upcoming_match', timestamp, payload: { round: 'QUAL', matchNum: 7, redTeams: ['1A'], blueTeams: ['2B'] },
  });

  it('shows a replayed spotlight straight away', async () => {
    const { grid, send } = load();
    await send(spot('1A', 100));
    expect(grid.classList.contains('mode-finals')).toBe(true);
    expect(grid.querySelector('.bar .number')?.textContent).toBe('1A');
  });

  it('shows the replayed match and then the replayed spotlight on top of it', async () => {
    const { grid, send } = load();
    await send(iq(100));
    expect(grid.classList.contains('mode-iq')).toBe(true);
    await send(spot('1A', 101));
    expect(grid.classList.contains('mode-finals')).toBe(true);
  });

  it('never lets an older replayed message overwrite a newer live one', async () => {
    const { grid, send } = load();
    await send(spot('2B', 200)); // live event that overtook the snapshot
    await send(spot('1A', 100)); // the replayed (older) spotlight arrives afterwards
    expect(grid.querySelector('.bar .number')?.textContent).toBe('2B');
  });

  it('applies a newer clear and keeps each message type independent', async () => {
    const { grid, send } = load();
    await send(spot('1A', 100));
    await send(iq(50)); // older timestamp, but a different type: still applied
    expect(grid.classList.contains('mode-finals')).toBe(true); // spotlight still wins
    await send(spot(null, 150));
    expect(grid.classList.contains('mode-finals')).toBe(false);
    expect(grid.classList.contains('mode-iq')).toBe(true); // back to the match
  });

  it('still accepts messages without a timestamp', async () => {
    const { grid, send } = load();
    await send({ type: 'show_team', payload: { team: '1A' } });
    expect(grid.classList.contains('mode-finals')).toBe(true);
  });
});
