const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

// Coverage for the h:mm:ss (Exercise Timer) and mm:ss (Rest / Instructions)
// duration pickers that replaced the old single "duration in seconds"
// number input - composing/decomposing correctly, picker visibility per
// activity type, and safely handling stored data from before these caps
// existed (Rest/Instructions used to share Exercise Timer's much higher
// limit).

async function seedRoutine(page, activities) {
  await page.evaluate((activities) => {
    state.routines = [{ id: 'duration-test-routine', name: 'Duration Test Routine', activities }];
    saveRoutines();
  }, activities);
  await page.reload();
  await page.waitForTimeout(300);
}

test.describe('Duration pickers: composition and picker choice per type', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
  });

  test('Exercise Timer shows the h:mm:ss picker; Rest and Instructions show mm:ss only', async ({ page }) => {
    await page.selectOption('#activity-type-select', 'exercise-timer');
    await expect(page.locator('#duration-picker-long')).toBeVisible();
    await expect(page.locator('#duration-picker-short')).toBeHidden();

    await page.selectOption('#activity-type-select', 'rest');
    await expect(page.locator('#duration-picker-long')).toBeHidden();
    await expect(page.locator('#duration-picker-short')).toBeVisible();

    await page.selectOption('#activity-type-select', 'instructions');
    await expect(page.locator('#duration-picker-long')).toBeHidden();
    await expect(page.locator('#duration-picker-short')).toBeVisible();
  });

  test('Exercise Timer duration round-trips through save and re-open (1:30:15 = 5415s)', async ({ page }) => {
    await page.selectOption('#activity-type-select', 'exercise-timer');
    await page.fill('#activity-title-input', 'Plank Hold');
    await page.selectOption('#activity-duration-hours', '1');
    await page.selectOption('#activity-duration-minutes-long', '30');
    await page.selectOption('#activity-duration-seconds-long', '15');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(() => state.editingRoutineDraft.activities.find(a => a.title === 'Plank Hold'));
    expect(saved.duration).toBe(5415);

    await page.locator('#activity-list-container .item-card', { hasText: 'Plank Hold' }).locator('button[title="Edit Activity"]').click();
    await page.waitForTimeout(300);
    expect(await page.inputValue('#activity-duration-hours')).toBe('1');
    expect(await page.inputValue('#activity-duration-minutes-long')).toBe('30');
    expect(await page.inputValue('#activity-duration-seconds-long')).toBe('15');
  });

  test('Rest duration round-trips through save and re-open (2:30 = 150s)', async ({ page }) => {
    await page.selectOption('#activity-type-select', 'rest');
    await page.fill('#activity-title-input', 'Water Break');
    await page.selectOption('#activity-duration-minutes-short', '2');
    await page.selectOption('#activity-duration-seconds-short', '30');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(() => state.editingRoutineDraft.activities.find(a => a.title === 'Water Break'));
    expect(saved.duration).toBe(150);

    await page.locator('#activity-list-container .item-card', { hasText: 'Water Break' }).locator('button[title="Edit Activity"]').click();
    await page.waitForTimeout(300);
    expect(await page.inputValue('#activity-duration-minutes-short')).toBe('2');
    expect(await page.inputValue('#activity-duration-seconds-short')).toBe('30');
  });
});

test.describe('Duration pickers: pre-existing data from before the per-type caps', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('an Exercise Timer duration well within the new 5-hour cap decomposes exactly (5445s = 1:30:45)', async ({ page }) => {
    await seedRoutine(page, [{ id: 'a1', type: 'exercise-timer', title: 'Old Plank', duration: 5445 }]);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#activity-list-container .item-card button[title="Edit Activity"]');
    await page.waitForTimeout(300);
    expect(await page.inputValue('#activity-duration-hours')).toBe('1');
    expect(await page.inputValue('#activity-duration-minutes-long')).toBe('30');
    expect(await page.inputValue('#activity-duration-seconds-long')).toBe('45');
  });

  test('a Rest duration that exceeds the new 5-minute cap (valid under the old shared limit) clamps to 5:00 instead of showing a blank, broken picker', async ({ page }) => {
    await seedRoutine(page, [{ id: 'a1', type: 'rest', title: 'Long Old Rest', duration: 600 }]);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#activity-list-container .item-card button[title="Edit Activity"]');
    await page.waitForTimeout(300);

    // Neither dropdown should be left without a valid selection.
    expect(await page.inputValue('#activity-duration-minutes-short')).toBe('5');
    expect(await page.inputValue('#activity-duration-seconds-short')).toBe('0');

    // Saving without changing anything keeps it at the clamped, valid max
    // rather than failing validation on a value the user never chose.
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-duration-error')).toBeHidden();
    const saved = await page.evaluate(() => state.editingRoutineDraft.activities.find(a => a.title === 'Long Old Rest'));
    expect(saved.duration).toBe(300);
  });
});
