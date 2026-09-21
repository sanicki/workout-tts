const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('Backup export/import round trip', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('exported backup JSON contains the current routines, settings, and favorites', async ({ page }) => {
    await page.evaluate(() => {
      state.favorites = [{ id: 'fav-backup-1', type: 'rest', title: 'Backup Favorite', duration: 30 }];
      saveFavorites();
    });

    await page.click('#tab-backup');
    await page.waitForTimeout(200);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-export-json'),
    ]);
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));

    expect(Array.isArray(exported.routines)).toBe(true);
    expect(exported.routines.length).toBeGreaterThan(0);
    expect(exported.favorites.some(f => f.title === 'Backup Favorite')).toBe(true);
    expect(exported.settings).toBeTruthy();
  });

  test('importing a backup file restores routines, settings, and favorites', async ({ page }) => {
    const backup = {
      routines: [
        {
          id: 'restored-routine-1',
          name: 'Restored Routine',
          activities: [
            { id: 'restored-activity-1', type: 'rest', title: 'Restored Rest', duration: 25 },
          ],
        },
      ],
      settings: { theme: 'dark', ticks: false, haptics: true, countdownThreshold: 5 },
      favorites: [
        { id: 'restored-fav-1', type: 'reps', title: 'Restored Favorite', reps: 8, pace: 2 },
      ],
    };
    const tmpFile = path.join(os.tmpdir(), `backup-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(backup));

    await page.click('#tab-backup');
    await page.waitForTimeout(200);
    await page.click('#btn-import-trigger');
    await page.setInputFiles('#file-import-json', tmpFile);
    await page.waitForTimeout(400);

    const routineNames = await page.evaluate(() => state.routines.map(r => r.name));
    expect(routineNames).toContain('Restored Routine');
    const favoritesTitles = await page.evaluate(() => state.favorites.map(f => f.title));
    expect(favoritesTitles).toContain('Restored Favorite');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');

    fs.unlinkSync(tmpFile);
  });

  test('importing a malformed backup file shows an error without crashing', async ({ page }) => {
    const tmpFile = path.join(os.tmpdir(), `bad-backup-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, 'not valid json {{{');

    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.click('#tab-backup');
    await page.waitForTimeout(200);
    await page.click('#btn-import-trigger');
    await page.setInputFiles('#file-import-json', tmpFile);
    await page.waitForTimeout(400);

    await expect(page.locator('.snackbar-container')).toContainText('Invalid backup file format');
    expect(consoleErrors).toEqual([]);

    fs.unlinkSync(tmpFile);
  });
});
