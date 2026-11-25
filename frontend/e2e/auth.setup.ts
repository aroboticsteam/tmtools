import { expect, test as setup } from '@playwright/test';
import { ADMIN_PASSWORD } from './helpers';

/** Logs in once through the real emergency-admin page and saves the session.
 * (`/admin_login` is an SPA page that posts to the backend; the session
 * cookie that answers is what the SPA then uses and it lands on `/`.) */
setup('sign in as admin_local', async ({ page }) => {
  await page.goto('/admin_login');
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Button pages' })).toBeVisible(); // sidebar nav
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
