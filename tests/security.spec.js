const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

// Regression coverage for the XSS/escaping audit: routine, activity, and
// favorite data can come from imported JSON (backup restore, routine
// import, LLM paste) with only shallow validation, so ids/titles/types
// are effectively attacker-controllable. These strings are crafted to
// break out of both innerHTML text nodes and the old
// onclick="...('${id}')" inline-handler JS-string context.
test.describe('XSS / escaping', () => {
  test('malicious routine/activity/favorite data renders as inert text, not live script', async ({ page }) => {
    await resetApp(page);

    let xssFired = false;
    page.on('dialog', async (dialog) => {
      if (dialog.message().includes('XSS')) xssFired = true;
      await dialog.dismiss();
    });
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const maliciousId = `x');alert('XSS-1');('`;
    const maliciousTitle = `<img src=x onerror="alert('XSS-2')">`;
    const maliciousBadgeType = `x"><script>alert('XSS-3')</script><span x="`;
    const maliciousReps = `<b onmouseover="alert('XSS-4')">reps</b>`;

    await page.evaluate(({ maliciousId, maliciousTitle, maliciousBadgeType, maliciousReps }) => {
      state.routines.push({
        id: 'r-xss-test',
        name: 'XSS Test Routine',
        activities: [{ id: maliciousId, type: maliciousBadgeType, title: maliciousTitle, reps: maliciousReps, pace: 2 }],
      });
      saveRoutines();
      state.favorites.push({ id: maliciousId, type: maliciousBadgeType, title: maliciousTitle, reps: maliciousReps, pace: 2 });
      saveFavorites();
    }, { maliciousId, maliciousTitle, maliciousBadgeType, maliciousReps });

    await page.reload();
    await page.waitForTimeout(300);
    await page.click('#tab-routines');
    await page.waitForTimeout(300);
    expect(xssFired).toBe(false);

    await page.locator('#routines-container .item-card', { hasText: 'XSS Test Routine' }).locator('button[title="Edit"]').click();
    await page.waitForTimeout(300);
    expect(xssFired).toBe(false);

    const titleText = await page.textContent('#activity-list-container .item-card .item-title');
    expect(titleText).toContain('<img');
    await expect(page.locator('#activity-list-container img')).toHaveCount(0);
    await expect(page.locator('#activity-list-container script')).toHaveCount(0);

    const editBtn = page.locator('#activity-list-container .item-card button[title="Edit Activity"]').first();
    await editBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeVisible();
    await expect(page.locator('#activity-title-input')).toHaveValue(maliciousTitle);
    await page.click('#btn-cancel-activity');
    await page.waitForTimeout(400);

    await page.locator('#activity-list-container .item-card button[title="Duplicate Activity"]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-list-container .item-card')).toHaveCount(2);

    await page.locator('#activity-list-container .item-card button[title="Delete Activity"]').last().click();
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-list-container .item-card')).toHaveCount(1);

    await page.click('#btn-cancel-routine');
    await page.waitForTimeout(400);

    await page.click('#routines-container .item-card:nth-child(1) button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-from-favorites');
    await page.waitForTimeout(400);
    expect(xssFired).toBe(false);
    await expect(page.locator('#favorites-picker-list img')).toHaveCount(0);

    await page.click('#btn-cancel-favorites-picker');
    await page.waitForTimeout(400);
    await page.click('#btn-cancel-routine');
    await page.waitForTimeout(400);

    expect(consoleErrors).toEqual([]);
    expect(xssFired).toBe(false);
  });
});
