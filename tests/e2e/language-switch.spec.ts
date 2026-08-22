import { test, expect } from '@playwright/test';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.111.1.31' } });

test('language switching works end to end and clears stale page caches', async ({ page }) => {
  const email = 'locale-' + Date.now() + '@test.dev';
  const password = 'supersecret';

  await page.goto('/signup');
  await page.getByLabel('Name').fill('Locale User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();

  await page.evaluate(async () => {
    await caches.open('pages-v2');
    await caches.open('pages-old');
    await caches.open('start-url');
    await caches.open('api-get');
  });

  await page.getByRole('button', { name: 'Change language' }).click();
  await page.getByRole('menuitem', { name: 'Russian' }).click();

  await expect(page.getByRole('link', { name: 'Главная' })).toBeVisible();
  const cachesAfterRussian = await page.evaluate(() => caches.keys());
  expect(cachesAfterRussian).not.toContain('pages-v2');
  expect(cachesAfterRussian).not.toContain('pages-old');
  expect(cachesAfterRussian).toContain('api-get');

});
