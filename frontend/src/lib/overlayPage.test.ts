import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The OBS overlay is a standalone page (backend/static/overlay.html), not part of
// the SPA, so load its script into jsdom and drive it through its test hooks.
const html = readFileSync(resolve(process.cwd(), '../backend/static/overlay.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

type Hooks = {
  handleMessage: (m: unknown) => Promise<void> | undefined;
  renderMatch: (p: unknown) => Promise<void>;
  setSpotlight: (n: string | null) => Promise<void>;
  bannerText: (p: unknown) => string;
  flagFor: (c: string) => string;
};

const FEED = {
  show_robot_name: false,
  teams: {
    '1A': { team_name: 'Alpha', country: 'United Kingdom', bot_url: 'http://x/1a.png', team_url: 'http://x/1a-team.png' },
    '2B': { team_name: 'Bravo', country: 'Turkey' },
    '3C': { team_name: 'Charlie', country: 'Canada' },
    '4D': { team_name: 'Delta', country: 'Narnia' },
  },
};

function load(): Hooks {
  document.body.innerHTML = '<div id="stage"><div id="grid"></div></div>';
  (window as unknown as Record<string, unknown>).__overlayTestHooks = undefined;
  new Function(script)();
  return (window as unknown as { __overlayTestHooks: Hooks }).__overlayTestHooks;
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', class { onclose: unknown; close() {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FEED })));
});

describe('overlay page layouts (#13)', () => {
  it('formats the match banner', () => {
    const h = load();
    expect(h.bannerText({ round: 'QUAL', matchNum: 191 })).toBe('Q 191');
    expect(h.bannerText({ round: 'SF', matchNum: 2 })).toBe('SF 2');
    expect(h.bannerText({})).toBe('');
  });

  it('maps countries to ISO codes', () => {
    const h = load();
    expect(h.flagFor('United Kingdom')).toBe('GB');
    expect(h.flagFor('Türkiye')).toBe('TR');
    expect(h.flagFor('Narnia')).toBe('');
  });

  it('renders VRC as 2x2 with VS, red left and blue right', async () => {
    const h = load();
    await h.renderMatch({ round: 'QUAL', matchNum: 7, redTeams: ['1A', '2B'], blueTeams: ['3C', '4D'] });
    const grid = document.getElementById('grid')!;
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
    const h = load();
    await h.renderMatch({ round: 'QUAL', matchNum: 42, redTeams: ['1A'], blueTeams: ['2B'] });
    const grid = document.getElementById('grid')!;
    expect(grid.classList.contains('mode-iq')).toBe(true);
    expect(grid.querySelectorAll('.cell.iq')).toHaveLength(2);
    expect(grid.querySelectorAll('.panel.red')).toHaveLength(0);
    expect(grid.querySelector('.vs')).toBeNull();
  });

  it('renders the single-team spotlight with bot, label bar and team photo', async () => {
    const h = load();
    await h.setSpotlight('1A');
    const grid = document.getElementById('grid')!;
    expect(grid.classList.contains('mode-finals')).toBe(true);
    expect(grid.querySelector('.bar .number')?.textContent).toBe('1A');
    expect(grid.querySelector('.bar .name')?.textContent).toBe('Alpha');
    expect(grid.querySelector('.bar .flag')).not.toBeNull();
    expect(grid.querySelector('.teamvid img')?.getAttribute('src')).toBe('http://x/1a-team.png');
  });
});

describe('overlay state after a reload (replayed snapshot)', () => {
  const spot = (team: string | null, timestamp: number) => ({ type: 'show_team', timestamp, payload: { team } });
  const match = (timestamp: number) => ({
    type: 'upcoming_match', timestamp, payload: { round: 'QUAL', matchNum: 7, redTeams: ['1A'], blueTeams: ['2B'] },
  });

  it('shows a replayed spotlight straight away', async () => {
    const h = load();
    await h.handleMessage(spot('1A', 100));
    const grid = document.getElementById('grid')!;
    expect(grid.classList.contains('mode-finals')).toBe(true);
    expect(grid.querySelector('.bar .number')?.textContent).toBe('1A');
  });

  it('shows the replayed match and then the replayed spotlight on top of it', async () => {
    const h = load();
    await h.handleMessage(match(100));
    const grid = document.getElementById('grid')!;
    expect(grid.classList.contains('mode-iq')).toBe(true);
    await h.handleMessage(spot('1A', 101));
    expect(grid.classList.contains('mode-finals')).toBe(true);
  });

  it('never lets an older replayed message overwrite a newer live one', async () => {
    const h = load();
    await h.handleMessage(spot('2B', 200)); // live event that overtook the snapshot
    await h.handleMessage(spot('1A', 100)); // the replayed (older) spotlight arrives afterwards
    expect(document.getElementById('grid')!.querySelector('.bar .number')?.textContent).toBe('2B');
  });

  it('ignores the same message delivered twice (a reconnect replays what is already on screen)', async () => {
    const h = load();
    await h.handleMessage(spot('1A', 100));
    const bar = document.getElementById('grid')!.querySelector('.bar');
    await h.handleMessage(spot('1A', 100));
    expect(document.getElementById('grid')!.querySelector('.bar')).toBe(bar); // not re-rendered
  });

  it('applies a newer clear and keeps each message type independent', async () => {
    const h = load();
    await h.handleMessage(spot('1A', 100));
    await h.handleMessage(match(50)); // older timestamp, but a different type: still applied
    expect(document.getElementById('grid')!.classList.contains('mode-finals')).toBe(true); // spotlight still wins
    await h.handleMessage(spot(null, 150));
    expect(document.getElementById('grid')!.classList.contains('mode-finals')).toBe(false);
  });

  it('still accepts messages without a timestamp', async () => {
    const h = load();
    await h.handleMessage({ type: 'show_team', payload: { team: '1A' } });
    expect(document.getElementById('grid')!.classList.contains('mode-finals')).toBe(true);
  });
});
