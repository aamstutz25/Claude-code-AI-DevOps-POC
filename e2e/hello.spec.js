import { expect, test } from '@playwright/test';

test('shows the greeting from SQL Server with the database connected', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Hello, World!' })).toBeVisible();
  await expect(page.getByText('Database connected')).toBeVisible();
  await expect(page).toHaveTitle('Hello POC');
  expect(consoleErrors).toEqual([]);
});
