import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { ok, uid } from './helpers';

async function makeStation(api: APIRequestContext, role = 'emcee') {
  const slug = uid('e2e-st');
  await ok(await api.post('/api/v1/comms/stations', { data: { slug, name: `Station ${slug}`, role } }));
  return slug;
}

const timers: string[] = [];

async function makeTimer(api: APIRequestContext, name: string, duration: number) {
  const entityId = uid('timer.e2e-st');
  await ok(await api.post('/api/v1/timers', { data: { entity_id: entityId, display_name: name, field_set_id: 1, field_id: 1, duration_s: duration } }));
  timers.push(entityId);
  return entityId;
}

/** The iPad: a separate, signed-out browser context. */
async function openStation(browser: Browser, url: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

test.describe('comms desk and station pages', () => {
  const slugs: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const slug of slugs.splice(0)) await request.delete(`/api/v1/comms/stations/${slug}`);
    for (const id of timers.splice(0)) await request.delete(`/api/v1/timers/${encodeURIComponent(id)}`);
    const agenda = await ok<{ id: string; title: string }[]>(await request.get('/api/v1/comms/agenda'));
    for (const item of agenda.filter((i) => i.title.startsWith('E2E'))) await request.delete(`/api/v1/comms/agenda/${item.id}`);
    await request.delete('/api/v1/comms/inbox');
  });

  test('messages go both ways and the desk sees the station come online', async ({ page, browser, request }) => {
    const slug = await makeStation(request);
    slugs.push(slug);
    const ipad = await openStation(browser, `/station/${slug}`);
    await expect(ipad.page.locator('#status')).toHaveText('live');

    await page.goto('/comms');
    const row = page.getByTestId('station-row').filter({ hasText: slug });
    await expect(row.getByTestId('presence')).toHaveAttribute('data-connected', 'true', { timeout: 20_000 });

    // Desk -> iPad
    await page.getByPlaceholder('Custom message…').fill('Teams to the stage please');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(ipad.page.getByText('Teams to the stage please')).toBeVisible();

    // iPad -> desk
    await ipad.page.getByPlaceholder('Message the desk…').fill('We are ready on stage');
    await ipad.page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('We are ready on stage')).toBeVisible({ timeout: 15_000 });

    await ipad.context.close();
    await expect(row.getByTestId('presence')).toHaveAttribute('data-connected', 'false', { timeout: 20_000 });
  });

  test('a timer instance shown on a station runs and stops on the iPad', async ({ page, browser, request }) => {
    const slug = await makeStation(request);
    slugs.push(slug);
    const timer = await makeTimer(request, 'Finals break', 300);
    const ipad = await openStation(browser, `/station/${slug}`);
    await expect(ipad.page.locator('#status')).toHaveText('live');

    await page.goto('/comms');
    await page.getByLabel('Timer to show').selectOption(timer);
    await page.getByRole('button', { name: 'Show on stations' }).click();

    const clock = ipad.page.locator('#tclock');
    await expect(clock).toBeVisible();
    await expect(ipad.page.getByText('Finals break')).toBeVisible();
    await expect(ipad.page.locator('#tstate')).toHaveText('Ready'); // idle until it is started where timers are managed
    await expect(clock).toHaveText('5:00');

    // Started like the prompter's timer: the iPad follows it live.
    await ok(await request.post(`/api/v1/timers/${encodeURIComponent(timer)}/start`));
    await expect(clock).toHaveClass(/green/);
    await expect(clock).toHaveText(/^(4:5\d|5:00)$/);
    const before = await clock.textContent();
    await expect.poll(() => clock.textContent(), { timeout: 5000 }).not.toBe(before); // it is running

    await ok(await request.post(`/api/v1/timers/${encodeURIComponent(timer)}/stop`));
    await expect(ipad.page.locator('#tstate')).toHaveText('Ready');
    await expect(clock).toHaveText('5:00');
    await ipad.context.close();
  });

  test('colour cues turn amber and red as a timer instance counts down', async ({ page, browser, request }) => {
    const slug = await makeStation(request);
    slugs.push(slug);
    const timer = await makeTimer(request, 'Cues', 40);
    const ipad = await openStation(browser, `/station/${slug}`);
    await expect(ipad.page.locator('#status')).toHaveText('live');
    await ok(await request.post('/api/v1/comms/screen', { data: { stations: [slug], screen: 'timer', timer } }));
    await ok(await request.post(`/api/v1/timers/${encodeURIComponent(timer)}/start`));
    const clock = ipad.page.locator('#tclock');
    await expect(clock).toHaveClass(/amber/, { timeout: 6000 }); // 40 s left is inside the 2 minute amber band
    await expect(clock).toHaveClass(/red/, { timeout: 15_000 }); // and red from 30 s
    await ok(await request.post(`/api/v1/timers/${encodeURIComponent(timer)}/stop`));
    await ipad.context.close();
    void page;
  });

  test('a secured station needs its key, then its PIN; rotating revokes the old link', async ({ page, browser, request }) => {
    const slug = await makeStation(request, 'camera');
    slugs.push(slug);
    await page.goto('/comms');
    const row = page.getByTestId('station-row').filter({ hasText: slug });

    page.once('dialog', (d) => void d.accept()); // "Secure ...?"
    await row.getByRole('button', { name: /Secure/ }).click();
    await expect(row.getByText('Private link')).toBeVisible();

    page.once('dialog', (d) => void d.accept('4821')); // PIN prompt
    await row.getByTitle('Set or remove the PIN').click();
    await expect(row.getByText('Key + PIN')).toBeVisible();
    const link = await ok<{ access_key: string; path: string }>(await request.get(`/api/v1/comms/stations/${slug}/link`));

    const bare = await openStation(browser, `/station/${slug}`);
    await expect(bare.page.getByText(/no longer valid/i)).toBeVisible();
    await bare.context.close();

    const ipad = await openStation(browser, link.path);
    await expect(ipad.page.getByText('Enter the station PIN')).toBeVisible();
    await ipad.page.locator('.gate input').fill('0000');
    await ipad.page.getByRole('button', { name: 'Unlock' }).click();
    await expect(ipad.page.getByText('Wrong PIN')).toBeVisible();
    await ipad.page.locator('.gate input').fill('4821');
    await ipad.page.getByRole('button', { name: 'Unlock' }).click();
    await expect(ipad.page.locator('#status')).toHaveText('live');
    await expect(ipad.page.locator('#name')).toContainText(slug);

    page.once('dialog', (d) => void d.accept()); // "Make a new link?"
    await row.getByRole('button', { name: /Rotate/ }).click();
    await expect.poll(async () => (await ok<{ access_key: string }>(await request.get(`/api/v1/comms/stations/${slug}/link`))).access_key).not.toBe(link.access_key);
    const stale = await openStation(browser, link.path);
    await expect(stale.page.getByText(/no longer valid/i)).toBeVisible();
    await Promise.all([ipad.context.close(), stale.context.close()]);
  });

  test('agenda rows reorder by dragging and bulk import adds items', async ({ page, request }) => {
    const titles = ['E2E Doors', 'E2E Opening', 'E2E Lunch'];
    const times = ['09:00', '10:00', '12:00'];
    for (const [i, title] of titles.entries()) {
      await ok(await request.post('/api/v1/comms/agenda', { data: { scope: 'day', start_time: times[i], title } }));
    }
    await page.goto('/comms');
    const rows = page.getByTestId('agenda-row').filter({ hasText: 'E2E' });
    await expect(rows).toHaveText([/E2E Doors/, /E2E Opening/, /E2E Lunch/]);
    await rows.filter({ hasText: 'E2E Lunch' }).dragTo(rows.filter({ hasText: 'E2E Doors' }));
    await expect(rows).toHaveText([/E2E Lunch/, /E2E Doors/, /E2E Opening/]);
    await page.reload();
    await expect(page.getByTestId('agenda-row').filter({ hasText: 'E2E' })).toHaveText([/E2E Lunch/, /E2E Doors/, /E2E Opening/]);

    await page.getByRole('button', { name: /^Import$/ }).click();
    const box = page.getByLabel('Agenda text');
    await box.fill('14:00 E2E Judging | Pit area\nbroken line');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('import-errors')).toContainText('Line 2');
    await box.fill('14:00 E2E Judging | Pit area');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('import-preview')).toContainText('1 item');
    await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
    await expect(page.getByTestId('agenda-row').filter({ hasText: 'E2E Judging' })).toBeVisible();
  });
});
