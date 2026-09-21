const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('Routine editor (full-screen dialog)', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('app bar stays pinned while the body scrolls', async ({ page }) => {
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);

    const barYBefore = await page.evaluate(() => document.querySelector('.fullscreen-dialog-bar').getBoundingClientRect().y);
    await page.evaluate(() => document.querySelector('.fullscreen-dialog-body')?.scrollBy(0, 2000));
    await page.waitForTimeout(150);
    const barYAfter = await page.evaluate(() => document.querySelector('.fullscreen-dialog-bar').getBoundingClientRect().y);

    expect(barYAfter).toBe(barYBefore);
    const saveBox = await page.locator('#btn-save-routine').boundingBox();
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(800);
  });

  test('dirty Cancel shows discard confirmation; clean Cancel closes silently', async ({ page }) => {
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);

    await page.fill('#routine-name-input', 'Changed Name');
    await page.click('#btn-cancel-routine');
    await page.waitForTimeout(300);
    await expect(page.locator('.dialog-backdrop.show')).toBeVisible();
    await expect(page.locator('#routine-editor-view')).toBeVisible();

    await page.click('.dialog-backdrop.show [data-action="cancel"]');
    await page.waitForTimeout(200);
    await expect(page.locator('#routine-editor-view')).toBeVisible();

    await page.click('#btn-cancel-routine');
    await page.waitForTimeout(300);
    await page.click('.dialog-backdrop.show [data-action="confirm"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#routine-editor-view')).toBeHidden();
  });

  test('routine name validation blocks save and clears live while typing', async ({ page }) => {
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);

    await page.fill('#routine-name-input', '');
    await page.click('#btn-save-routine');
    await page.waitForTimeout(200);
    await expect(page.locator('#routine-name-error')).toBeVisible();
    await expect(page.locator('#routine-name-input')).toHaveClass(/input-error/);

    await page.fill('#routine-name-input', 'Fixed Name');
    await page.waitForTimeout(100);
    await expect(page.locator('#routine-name-error')).toBeHidden();

    await page.click('#btn-save-routine');
    await page.waitForTimeout(300);
    await expect(page.locator('#routine-editor-view')).toBeHidden();
  });

  test('Play, Edit, Duplicate, and Delete all work from the routines list', async ({ page }) => {
    const playBox = await page.locator('#routines-container .item-card button[title="Start Routine"]').boundingBox();
    const editBox = await page.locator('#routines-container .item-card button[title="Edit"]').boundingBox();
    const dupBox = await page.locator('#routines-container .item-card button[title="Duplicate"]').boundingBox();
    expect(playBox.x).toBeLessThan(editBox.x);
    expect(editBox.x).toBeLessThan(dupBox.x);

    await page.click('#routines-container .item-card button[title="Duplicate"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#routines-container .item-card')).toHaveCount(2);

    await page.click('#routines-container .item-card:nth-child(1) button[title="Start Routine"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#player-view')).toBeVisible();
    await page.click('#btn-stop');
    await page.waitForTimeout(200);
    if (await page.locator('.dialog-backdrop.show').isVisible()) {
      await page.click('.dialog-backdrop.show [data-action="confirm"]');
      await page.waitForTimeout(300);
    }

    await page.click('#routines-container .item-card:nth-child(1) button[title="Delete"]');
    await page.waitForTimeout(300);
    await page.click('.dialog-backdrop.show [data-action="confirm"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#routines-container .item-card')).toHaveCount(1);
  });
});
