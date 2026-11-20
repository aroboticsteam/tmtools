import { expect, test } from '@playwright/test';

test('take a photo with a synthetic camera, review it, and upload it', async ({ page }) => {
  // The processing/S3 side has its own backend tests; here the upload is intercepted
  // so the test covers what the browser does: camera -> countdown -> snap -> review -> upload.
  const uploads: { url: string; contentType: string; size: number }[] = [];
  await page.route('**/api/v1/teams/E2E1A/photos/bot_photo', async (route) => {
    const request = route.request();
    uploads.push({ url: request.url(), contentType: request.headers()['content-type'] ?? '', size: request.postDataBuffer()?.length ?? 0 });
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ team_number: 'E2E1A', kind: 'bot_photo', status: 'PROCESSING' }) });
  });

  await page.goto('/record');
  await expect(page.getByRole('button', { name: /Take photo/ })).toBeDisabled(); // no team yet
  await page.getByPlaceholder('21549A').fill('e2e1a');
  await expect(page.getByRole('button', { name: /Take photo/ })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: /Take photo/ }).click();

  await expect(page.getByRole('button', { name: /Upload photo/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Upload photo/ }).click();
  await expect(page.getByText(/E2E1A robot photo uploaded/)).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].contentType).toContain('multipart/form-data');
  expect(uploads[0].size).toBeGreaterThan(1000); // a real JPEG, not an empty file
  await expect(page.getByRole('button', { name: /Take photo/ })).toBeVisible(); // back to a fresh take
});

test('retake discards the photo and returns to the camera', async ({ page }) => {
  await page.goto('/record');
  await page.getByPlaceholder('21549A').fill('E2E1A');
  await expect(page.getByRole('button', { name: /Take photo/ })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: /Take photo/ }).click();
  await expect(page.getByRole('button', { name: /Retake/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Retake/ }).click();
  await expect(page.getByRole('button', { name: /Take photo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Upload photo/ })).toHaveCount(0);
});
