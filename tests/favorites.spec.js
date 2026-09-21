const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('Favorites heart-toggle and picker', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
  });

  test('heart auto-matches an identical activity and survives unrelated edits', async ({ page }) => {
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
    await page.fill('#activity-title-input', 'Heart Test Curls');
    await page.fill('#activity-reps-input', '10');
    await page.fill('#activity-pace-input', '2');

    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.click('#btn-favorite-toggle');
    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    let favorites = await page.evaluate(() => state.favorites);
    expect(favorites.some(f => f.title === 'Heart Test Curls')).toBe(true);

    // Re-opening the matching activity should show it as already favorited.
    await page.locator('#activity-list-container .item-card', { hasText: 'Heart Test Curls' }).locator('button[title="Edit Activity"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');

    // Editing the title away from the match should clear auto-match state.
    await page.fill('#activity-title-input', 'Heart Test Curls Renamed');
    await page.waitForTimeout(100);
    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'false');

    await page.click('#btn-cancel-activity');
    await page.waitForTimeout(400);
  });

  test('un-favoriting removes the entry from favorites', async ({ page }) => {
    await page.evaluate(() => {
      state.favorites = [{ id: 'fav-test-1', type: 'rest', title: 'Removable Favorite', duration: 20 }];
      saveFavorites();
    });
    await page.click('#btn-from-favorites');
    await page.waitForTimeout(400);
    await expect(page.locator('#favorites-picker-list .item-card')).toHaveCount(1);

    await page.click('#favorites-picker-list .item-card button[title="Remove from Favorites"]');
    await page.waitForTimeout(300);
    await page.click('.dialog-backdrop.show [data-action="confirm"]');
    await page.waitForTimeout(300);
    const favorites = await page.evaluate(() => state.favorites);
    expect(favorites.length).toBe(0);
  });

  test('tapping a favorites-picker row adds an independent copy to the routine', async ({ page }) => {
    await page.evaluate(() => {
      state.favorites = [{ id: 'fav-test-2', type: 'rest', title: 'Reusable Rest', duration: 15 }];
      saveFavorites();
    });
    const activityCountBefore = await page.locator('#activity-list-container .item-card').count();

    await page.click('#btn-from-favorites');
    await page.waitForTimeout(400);
    await page.click('#favorites-picker-list .item-content');
    await page.waitForTimeout(300);

    await expect(page.locator('#activity-list-container .item-card')).toHaveCount(activityCountBefore + 1);
    const addedActivity = await page.evaluate(() => state.editingRoutineDraft.activities.find(a => a.title === 'Reusable Rest'));
    expect(addedActivity).toBeTruthy();
    expect(addedActivity.id).not.toBe('fav-test-2');
  });
});
