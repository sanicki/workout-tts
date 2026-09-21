const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('Settings: switches, theme toggle, discrete slider', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#tab-settings');
    await page.waitForTimeout(300);
  });

  test('the Ticks switch toggles and persists via clicking its track', async ({ page }) => {
    await expect(page.locator('#chk-ticks')).toBeChecked();
    await page.click('#chk-ticks + .switch-track');
    await page.waitForTimeout(200);
    await expect(page.locator('#chk-ticks')).not.toBeChecked();

    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('vrc_settings')).ticks);
    expect(persisted).toBe(false);
  });

  test('the discrete countdown-threshold slider exposes 11 tick options', async ({ page }) => {
    const tickCount = await page.locator('#countdown-threshold-ticks option').count();
    const listAttr = await page.getAttribute('#countdown-threshold-range', 'list');
    expect(tickCount).toBe(11);
    expect(listAttr).toBe('countdown-threshold-ticks');
  });

  test('Light/Dark/System theme toggle applies immediately and persists across reload', async ({ page }) => {
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(initialTheme).toBeNull();

    await page.click('.segmented-option[data-theme-option="dark"]');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const persistedTheme = await page.evaluate(() => JSON.parse(localStorage.getItem('vrc_settings')).theme);
    expect(persistedTheme).toBe('dark');

    await page.reload();
    await page.waitForTimeout(200);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.click('#tab-settings');
    await page.waitForTimeout(200);
    await page.click('.segmented-option[data-theme-option="light"]');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.click('.segmented-option[data-theme-option="system"]');
    await page.waitForTimeout(300);
    const systemAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(systemAttr).toBeNull();
  });
});
