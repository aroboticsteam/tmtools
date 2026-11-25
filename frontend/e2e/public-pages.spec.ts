import { expect, test } from '@playwright/test';
import { ok, uid } from './helpers';

// Every former backend-served page is an SPA route now. They must work signed out (a fresh,
// cookie-less context), keep their old URLs, and never render the admin shell.
test.describe('public pages (signed out, no admin shell)', () => {
  test('room display, notify, station and teleprompter open at their old URLs', async ({ browser, request }) => {
    const slug = uid('e2e-room').toLowerCase();
    const station = uid('e2e-st').toLowerCase();
    const timerId = uid('timer.e2e_pp');
    await ok(await request.post('/api/v1/rooms', { data: { slug, name: 'E2E Pit', stream_url: null, teams: ['E2E1A'] } }));
    await ok(await request.post('/api/v1/comms/stations', { data: { slug: station, name: 'E2E Desk iPad', role: 'emcee' } }));
    const timer = await ok<{ entity_id: string; prompter_token: string }>(
      await request.post('/api/v1/timers', { data: { entity_id: timerId, display_name: 'E2E prompter', field_set_id: 1, field_id: 1, tags: [] } }),
    );
    try {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await ctx.newPage();
      const noShell = async () => {
        await expect(page.locator('aside')).toHaveCount(0);
        expect(new URL(page.url()).pathname).not.toMatch(/auth|admin_login/);
      };

      await page.goto(`/room/${slug}`);
      await expect(page.getByRole('heading', { name: 'E2E Pit' })).toBeVisible();
      await expect(page.getByText('E2E1A')).toBeVisible();
      await expect(page.getByText('live')).toBeVisible();
      await noShell();
      await page.goto('/room/does-not-exist');
      await expect(page.getByText('Room not found.')).toBeVisible();

      await page.goto('/notify');
      await expect(page.getByRole('heading', { name: 'Match alerts' })).toBeVisible();
      await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/notify.webmanifest');
      await noShell();
      const manifest = await request.get('/notify.webmanifest');
      expect(manifest.headers()['content-type']).toContain('application/manifest+json');
      expect((await manifest.json()).theme_color).toBe('#171717');
      const sw = await request.get('/sw.js');
      expect(sw.headers()['service-worker-allowed']).toBe('/');
      expect(await sw.text()).toContain('showNotification');

      await page.goto(`/station/${station}`);
      await expect(page.getByRole('heading', { name: 'E2E Desk iPad' })).toBeVisible();
      await expect(page.getByPlaceholder('Message the desk…')).toBeVisible();
      await noShell();

      await page.goto(`/prompter/${timer.entity_id}?token=${timer.prompter_token}`);
      await expect(page.getByRole('button', { name: 'Start Countdown' })).toBeVisible();
      await expect(page.getByText('Waiting for cues…')).toBeVisible();
      await noShell();
      await page.goto(`/prompter/${timer.entity_id}?token=wrong`);
      await expect(page.getByRole('alert')).toContainText('Invalid or expired teleprompter token');

      await page.goto('/replay/e2e-main');
      await expect(page.locator('#player')).toBeAttached();
      await page.goto('/site/leaderboard');
      await expect(page.locator('#prog')).toBeAttached();
      await ctx.close();
    } finally {
      await request.delete(`/api/v1/timers/${timerId}`);
      await request.delete(`/api/v1/comms/stations/${station}`);
      await request.delete(`/api/v1/rooms/${slug}`);
    }
  });

  test('a secured station asks for its PIN before showing anything', async ({ browser, request }) => {
    const station = uid('e2e-pin').toLowerCase();
    await ok(await request.post('/api/v1/comms/stations', { data: { slug: station, name: 'E2E Secured', role: 'emcee' } }));
    const link = await ok<{ path: string }>(await request.post(`/api/v1/comms/stations/${station}/rotate-link`));
    await ok(await request.put(`/api/v1/comms/stations/${station}/pin`, { data: { pin: '4321' } }));
    try {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await ctx.newPage();
      await page.goto(link.path);
      await expect(page.getByText('Enter the station PIN')).toBeVisible();
      await page.locator('input[type=password]').fill('0000');
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page.getByText('Wrong PIN')).toBeVisible();
      await page.locator('input[type=password]').fill('4321');
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page.getByRole('heading', { name: 'E2E Secured' })).toBeVisible();
      await page.goto(`/station/${station}`); // no key at all
      await expect(page.getByText(/no longer valid/)).toBeVisible();
      await ctx.close();
    } finally {
      await request.delete(`/api/v1/comms/stations/${station}`);
    }
  });
});
