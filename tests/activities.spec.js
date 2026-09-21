const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('Activity CRUD and validation', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
  });

  test('icon order is Edit, Duplicate, Delete with no Play button', async ({ page }) => {
    const editBox = await page.locator('#activity-list-container .item-card button[title="Edit Activity"]').first().boundingBox();
    const dupBox = await page.locator('#activity-list-container .item-card button[title="Duplicate Activity"]').first().boundingBox();
    const delBox = await page.locator('#activity-list-container .item-card button[title="Delete Activity"]').first().boundingBox();
    expect(editBox.x).toBeLessThan(dupBox.x);
    expect(dupBox.x).toBeLessThan(delBox.x);
    await expect(page.locator('#activity-list-container .item-card button[title="Start Routine"]')).toHaveCount(0);
  });

  test('empty title and invalid reps are rejected with inline errors that clear live', async ({ page }) => {
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);

    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-title-error')).toBeVisible();

    await page.fill('#activity-title-input', 'Test Exercise');
    await page.fill('#activity-reps-input', '0');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-reps-error')).toBeVisible();
    await expect(page.locator('#activity-title-error')).toBeHidden();

    await page.fill('#activity-reps-input', '10');
    await page.waitForTimeout(100);
    await expect(page.locator('#activity-reps-error')).toBeHidden();

    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => state.editingRoutineDraft.activities.some(a => a.title === 'Test Exercise'));
    expect(saved).toBe(true);
  });

  test('a fresh Add Activity form has no stale errors from a previous attempt', async ({ page }) => {
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-title-error')).toBeVisible();
    await page.click('#btn-cancel-activity');
    await page.waitForTimeout(400);

    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-title-error')).toBeHidden();
    await expect(page.locator('#activity-reps-error')).toBeHidden();
  });

  test('Edit, Duplicate, and Delete work on an existing activity', async ({ page }) => {
    const countBefore = await page.locator('#activity-list-container .item-card').count();

    await page.locator('#activity-list-container .item-card button[title="Edit Activity"]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeVisible();
    await page.click('#btn-cancel-activity');
    await page.waitForTimeout(400);

    await page.locator('#activity-list-container .item-card button[title="Duplicate Activity"]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-list-container .item-card')).toHaveCount(countBefore + 1);

    await page.locator('#activity-list-container .item-card button[title="Delete Activity"]').last().click();
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-list-container .item-card')).toHaveCount(countBefore);
  });
});
