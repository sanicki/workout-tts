const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

// Coverage for the Instructions activity type: it has no user-set duration
// at all any more - the editor shows only the instructions textarea, and at
// playback the phase runs for exactly as long as the instructions take to
// read aloud, then advances 1s after the speech finishes. Skip still cuts
// it short immediately, and Pause/Resume restarts the narration from the
// beginning (there's no way to resume mid-utterance).

async function seedRoutineAndReload(page, activities) {
  await page.evaluate((activities) => {
    state.routines = [{ id: 'instructions-test-routine', name: 'Instructions Test Routine', activities }];
    saveRoutines();
  }, activities);
  await page.reload();
  await page.waitForTimeout(300);
}

// Replaces audioEngine.speak with a recording stub that captures each
// call's onEndCallback instead of driving it through the real (slow, and in
// a headless sandbox unreliable) speechSynthesis API - lets the Instructions
// phase's speech-driven completion be triggered deterministically.
async function stubSpeak(page) {
  await page.evaluate(() => {
    window.__speakCalls = [];
    audioEngine.speak = (text, priority, onEndCallback) => {
      window.__speakCalls.push(text);
      window.__lastSpeakCallback = onEndCallback || null;
    };
  });
}

test.describe('Instructions activity type: editor', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
    await page.selectOption('#activity-type-select', 'instructions');
  });

  test('shows only the instructions textarea - no duration field at all', async ({ page }) => {
    await expect(page.locator('#duration-fields')).toBeHidden();
    await expect(page.locator('#instructions-fields')).toBeVisible();
  });

  test('empty instructions blocks save with an inline error', async ({ page }) => {
    await page.fill('#activity-title-input', 'Get Ready');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-instructions-error')).toBeVisible();
    await expect(page.locator('#activity-instructions-error')).toContainText('cannot be empty');
  });

  test('saves with instructions text and no duration field, shown in the activity list', async ({ page }) => {
    await page.fill('#activity-title-input', 'Push-ups Setup');
    await page.fill('#activity-instructions-input', 'Get into push-up position, hands under shoulders.');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(() => state.editingRoutineDraft.activities.find(a => a.title === 'Push-ups Setup'));
    expect(saved.duration).toBeUndefined();
    expect(saved.instructions).toBe('Get into push-up position, hands under shoulders.');

    await expect(page.locator('#activity-list-container .item-card', { hasText: 'Push-ups Setup' }))
      .toContainText('Get into push-up position, hands under shoulders.');
  });
});

test.describe('Instructions activity type: execution engine', () => {
  const activities = [
    { id: 'a1', type: 'instructions', title: 'Push-ups Setup', instructions: 'Get into push-up position.' },
    { id: 'a2', type: 'rest', title: 'Cooldown', duration: 3 }
  ];

  test('ends 1s after the TTS finishes, not on a fixed timer', async ({ page }) => {
    await resetApp(page);
    await seedRoutineAndReload(page, activities);
    await stubSpeak(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);

    // The instructions text was spoken, and the routine hasn't moved on
    // while speech is still "in progress" (callback not yet fired).
    const speakCalls = await page.evaluate(() => window.__speakCalls);
    expect(speakCalls).toEqual(['Get into push-up position.']);
    let activityIndex = await page.evaluate(() => executionEngine.activityIndex);
    expect(activityIndex).toBe(0);

    // Simulate the TTS finishing - should still wait ~1s before advancing.
    await page.evaluate(() => window.__lastSpeakCallback());
    activityIndex = await page.evaluate(() => executionEngine.activityIndex);
    expect(activityIndex).toBe(0);

    await page.waitForTimeout(1200);
    activityIndex = await page.evaluate(() => executionEngine.activityIndex);
    expect(activityIndex).toBe(1);
  });

  test('"Get Ready" renders at the smaller text size, not the 7rem number/timer size', async ({ page }) => {
    await resetApp(page);
    await seedRoutineAndReload(page, activities);
    await stubSpeak(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);

    await expect(page.locator('#counter-display')).toHaveText('Get Ready');
    await expect(page.locator('#counter-display')).toHaveClass(/counter-display-text/);
    await expect(page.locator('#counter-sub')).toContainText('Get into push-up position.');

    // The class shouldn't leak into a later, genuinely numeric phase.
    await page.evaluate(() => window.__lastSpeakCallback());
    await page.waitForTimeout(1200);
    await expect(page.locator('#counter-display')).not.toHaveClass(/counter-display-text/);
  });

  test('Skip cuts it short immediately, even before the TTS finishes', async ({ page }) => {
    await resetApp(page);
    await seedRoutineAndReload(page, activities);
    await stubSpeak(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);

    await page.click('#btn-skip');
    await page.waitForTimeout(100);
    const activityIndex = await page.evaluate(() => executionEngine.activityIndex);
    expect(activityIndex).toBe(1);
  });

  test('Pause during the reading, then Resume, restarts the instructions from the beginning', async ({ page }) => {
    await resetApp(page);
    await seedRoutineAndReload(page, activities);
    await stubSpeak(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    let speakCalls = await page.evaluate(() => window.__speakCalls);
    expect(speakCalls).toEqual(['Get into push-up position.']);

    // Pause mid-speech (the callback never fired, simulating narration
    // still in progress) and confirm the running speech was cut off.
    await page.click('#btn-pause');
    await page.waitForTimeout(100);
    const isPaused = await page.evaluate(() => executionEngine.isPaused);
    expect(isPaused).toBe(true);

    // Resume - restarts the phase, re-speaking from the start rather than
    // trying to resume mid-utterance.
    await stubSpeak(page); // re-stub since resuming calls the real speak() again synchronously before we can intercept otherwise
    await page.click('#btn-pause');
    await page.waitForTimeout(100);
    speakCalls = await page.evaluate(() => window.__speakCalls);
    expect(speakCalls).toEqual(['Get into push-up position.']);
    const activityIndex = await page.evaluate(() => executionEngine.activityIndex);
    expect(activityIndex).toBe(0);

    // Finishing normally from here still advances after the usual 1s beat.
    await page.evaluate(() => window.__lastSpeakCallback());
    await page.waitForTimeout(1200);
    const finalIndex = await page.evaluate(() => executionEngine.activityIndex);
    expect(finalIndex).toBe(1);
  });

  test('the next-up preview omits a duration for an upcoming Instructions activity', async ({ page }) => {
    const reversedActivities = [
      { id: 'a1', type: 'rest', title: 'Warmup Rest', duration: 3 },
      { id: 'a2', type: 'instructions', title: 'Push-ups Setup', instructions: 'Get into push-up position.' }
    ];
    await resetApp(page);
    await seedRoutineAndReload(page, reversedActivities);
    await stubSpeak(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    const preview = await page.evaluate(() => executionEngine.getNextPreview());
    expect(preview).toBe('Next: Push-ups Setup');
  });
});
