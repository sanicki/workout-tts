const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

async function dragHandleDown(page, selector, dy) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = Math.max(1, Math.round(dy / 40));
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps, { steps: 2 });
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
}

test.describe('Bottom sheets: pinned header/footer, swipe-to-dismiss', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('export sheet footer stays pinned while the routine list scrolls', async ({ page }) => {
    await page.click('#tab-backup');
    await page.waitForTimeout(200);
    await page.click('#btn-export-routines');
    await page.waitForTimeout(400);

    const footerYBefore = await page.locator('#btn-confirm-export').boundingBox();
    await page.evaluate(() => document.getElementById('export-routines-list')?.scrollBy(0, 2000));
    await page.waitForTimeout(150);
    const footerYAfter = await page.locator('#btn-confirm-export').boundingBox();

    expect(Math.round(footerYAfter.y)).toBe(Math.round(footerYBefore.y));
    await page.click('#btn-cancel-export');
    await page.waitForTimeout(400);
  });

  test('a not-dirty activity sheet closes on swipe-down without confirmation', async ({ page }) => {
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(400);

    await expect(page.locator('#activity-modal .sheet-drag-handle')).toBeVisible();
    await dragHandleDown(page, '#activity-modal .sheet-drag-handle', 400);
    await page.waitForTimeout(400);

    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('a dirty activity sheet shows a discard-confirm dialog on swipe-down', async ({ page }) => {
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(400);
    await page.fill('#activity-title-input', 'Dirty Field');

    await dragHandleDown(page, '#activity-modal .sheet-drag-handle', 400);
    await page.waitForTimeout(400);

    await expect(page.locator('.dialog-backdrop.show')).toBeVisible();
    await page.click('.dialog-backdrop.show [data-action="confirm"]');
    await page.waitForTimeout(400);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('a small drag under the dismiss threshold snaps back open', async ({ page }) => {
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(400);

    await dragHandleDown(page, '#activity-modal .sheet-drag-handle', 20);
    await page.waitForTimeout(400);

    await expect(page.locator('#activity-modal')).toBeVisible();
    await page.click('#btn-cancel-activity');
    await page.waitForTimeout(400);
  });
});
