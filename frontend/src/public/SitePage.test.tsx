import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SitePage, themeCss } from './SitePage';

const OVERVIEW = {
  title: 'Example Battle',
  presented_by: 'Example Org',
  theme: { dark: { primary: '#112233', accent: '#abc' }, light: { bg: '#F0F0F0' } },
  hero: { image_url: null },
  sponsors: [],
  next_competition: null,
};
const EVENT = {
  divisions: { '1': { programme: 'iq' } },
  agenda: [],
  matches: [
    { label: 'Q1', division: '1', programme: 'iq', scheduled_at: 1000, red: ['1A'], blue: ['2B'], score: [50, 30], recording_url: 'https://rec/q1' },
    { label: 'Q2', division: '1', programme: 'iq', scheduled_at: 2000, red: ['3C'], blue: ['4D'], score: null },
  ],
  rankings: [{ rank: 1, division: '1', team: '1A', team_name: 'Alpha', avg_points: 40, high_score: 50 }],
  skills: [{ rank: 1, division: '1', team: '1A', total: 90, driver: 50, prog: 40, driver_attempts: 2, prog_attempts: 1 }],
};
const TEAM = {
  team_number: '1A', team_name: 'Alpha', programme: 'iq', current: { qual_rank: 1, skills_rank: 2 },
  season: { events_attended: 2, awards: 1, previous_rankings: [{ event: { name: 'Nationals', start: '2026-03-01T00:00' }, rank: 3, finals_rank: 2 }], award_list: [{ event_name: 'Nationals', title: 'Excellence' }] },
  photos: { bot: 'http://x/bot.png' }, schedule: EVENT.matches,
};

function respond(url: string) {
  if (url.endsWith('/overview')) return OVERVIEW;
  if (url.endsWith('/event')) return EVENT;
  if (url.includes('/teams/')) return TEAM;
  if (url.endsWith('/teams')) return [{ team_number: '1A', team_name: 'Alpha', qual_rank: 1, skills_rank: 2 }];
  return [];
}

function renderAt(hash: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/site${hash}`]}>
        <SitePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => JSON.stringify(respond(String(url))) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('themeCss', () => {
  it('applies overrides token by token, light ones only when the device asks for light', () => {
    expect(themeCss(OVERVIEW.theme)).toBe('.pubsite{--primary:#112233;--accent:#abc;}@media (prefers-color-scheme: light){.pubsite{--bg:#F0F0F0;}}');
    expect(themeCss(null)).toBe('');
    expect(themeCss({ dark: {} })).toBe('');
  });
});

describe('public site', () => {
  it('home: welcome hero, live standings tabs and links, no admin shell', async () => {
    renderAt('');
    expect(await screen.findByRole('heading', { name: 'Welcome to Example Battle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Top 50 qualification rankings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Top 50 skills' })).toBeTruthy();
    expect(screen.getByText('Get match alerts on your phone').getAttribute('href')).toBe('/notify');
    expect(document.querySelector('aside')).toBeNull();
    expect(document.querySelector('.pubsite style')?.textContent).toContain('--primary:#112233');
  });

  it('event: IQ shows one Teams column and a single score, with the match number linking to its video', async () => {
    renderAt('#event');
    await screen.findByRole('button', { name: 'Matches' });
    screen.getByRole('button', { name: 'Matches' }).click();
    const q1 = await screen.findByRole('row', { name: /Q1/ });
    expect(within(q1).getByRole('link', { name: 'Q1' }).getAttribute('href')).toBe('https://rec/q1');
    expect(within(q1).getByText('50')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Red' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Teams' })).toBeTruthy();
  });

  it('team page: photo download and season history with finals placement', async () => {
    renderAt('#team/1A');
    expect(await screen.findByRole('heading', { name: /1A — Alpha/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Season history')).toBeTruthy());
    expect(screen.getByText('Finals ranking')).toBeTruthy();
    expect(screen.getByText('🏆 Excellence')).toBeTruthy();
    expect(screen.getByText(/Download robot photo/)).toBeTruthy();
  });
});
