const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

// Coverage for Sets / Rest Between Sets on the Reps Counter activity type:
// form validation, the activity-card summary, Favorites matching, the
// execution engine's set/rest state machine (including Skip), and the
// back-to-back (0 rest) case.

// Replaces audioEngine.speak with a synchronous stub: any onEndCallback
// fires immediately instead of waiting on the real (slow, and in a
// headless sandbox often silent) speechSynthesis API. This lets tests
// drive the execution engine deterministically. Every call's (text,
// priority) pair is recorded on window.__speakCalls for assertions on
// what was actually announced.
async function stubSpeechAndReturnCalls(page) {
  await page.evaluate(() => {
    window.__speakCalls = [];
    audioEngine.speak = (text, priority, onEndCallback) => {
      window.__speakCalls.push(text);
      if (onEndCallback) onEndCallback();
    };
  });
}

// Forces the engine's current phase to expire on the next tick, applies
// that one tick synchronously, then kills the real setInterval loop the
// phase transition may have just (re)started - so only these explicit,
// deterministic steps advance state, never real wall-clock time.
async function forceAdvance(page) {
  await page.evaluate(() => {
    executionEngine.accTime = -1;
    executionEngine.lastTime = performance.now();
    executionEngine.tick();
    executionEngine.stopLoop();
  });
}

// Sets is a stepper (min/max buttons), not a free-typed field - drives it
// to an exact target value by clicking + or - the right number of times.
async function setSetsViaStepper(page, target) {
  let current = parseInt(await page.inputValue('#activity-sets-input'), 10);
  const button = target > current ? '#btn-sets-increment' : '#btn-sets-decrement';
  while (current !== target) {
    await page.click(button);
    current = target > current ? current + 1 : current - 1;
  }
}

async function seedSetsRoutine(page, activities) {
  await page.evaluate((activities) => {
    state.routines = [{ id: 'sets-test-routine', name: 'Sets Test Routine', activities }];
    saveRoutines();
  }, activities);
  await page.reload();
  await page.waitForTimeout(300);
}

test.describe('Reps Counter: Sets / Rest Between Sets form', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
  });

  test('default to Sets=1 / Rest=0:00, and both are always visible for a Reps activity', async ({ page }) => {
    await expect(page.locator('#activity-sets-input')).toBeVisible();
    await expect(page.locator('#activity-rest-between-sets-minutes')).toBeVisible();
    await expect(page.locator('#activity-rest-between-sets-seconds')).toBeVisible();
    expect(await page.inputValue('#activity-sets-input')).toBe('1');
    expect(await page.inputValue('#activity-rest-between-sets-minutes')).toBe('0');
    expect(await page.inputValue('#activity-rest-between-sets-seconds')).toBe('0');
  });

  test('Rest Between Sets is disabled and zeroed at Sets=1, and re-enables above it', async ({ page }) => {
    // Sets=1 by default: Rest Between Sets should already be disabled and
    // visibly dimmed - there's no "between sets" with only one set.
    await expect(page.locator('#activity-rest-between-sets-minutes')).toBeDisabled();
    await expect(page.locator('#activity-rest-between-sets-seconds')).toBeDisabled();
    await expect(page.locator('#rest-between-sets-group')).toHaveClass(/field-disabled/);

    // Raising Sets re-enables it.
    await setSetsViaStepper(page, 3);
    await expect(page.locator('#activity-rest-between-sets-minutes')).toBeEnabled();
    await expect(page.locator('#activity-rest-between-sets-seconds')).toBeEnabled();
    await expect(page.locator('#rest-between-sets-group')).not.toHaveClass(/field-disabled/);

    await page.selectOption('#activity-rest-between-sets-minutes', '1');
    await page.selectOption('#activity-rest-between-sets-seconds', '15');

    // Dropping back to Sets=1 disables it again AND zeroes out whatever
    // was selected, so a leftover non-zero value can't be silently saved
    // and silently ignored by the execution engine (the reported bug).
    await setSetsViaStepper(page, 1);
    await expect(page.locator('#activity-rest-between-sets-minutes')).toBeDisabled();
    expect(await page.inputValue('#activity-rest-between-sets-minutes')).toBe('0');
    expect(await page.inputValue('#activity-rest-between-sets-seconds')).toBe('0');

    await page.fill('#activity-title-input', 'Single Set Activity');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => state.editingRoutineDraft.activities.find(a => a.title === 'Single Set Activity'));
    expect(saved.restBetweenSets).toBe(0);
  });

  test('Sets stepper is clamped to 1-5: boundary buttons disable, and clicks past a boundary are no-ops', async ({ page }) => {
    // At the default Sets=1, decrement is disabled and does nothing.
    await expect(page.locator('#btn-sets-decrement')).toBeDisabled();
    await page.click('#btn-sets-decrement', { force: true });
    expect(await page.inputValue('#activity-sets-input')).toBe('1');

    await setSetsViaStepper(page, 5);
    expect(await page.inputValue('#activity-sets-input')).toBe('5');
    await expect(page.locator('#btn-sets-increment')).toBeDisabled();
    await page.click('#btn-sets-increment', { force: true });
    expect(await page.inputValue('#activity-sets-input')).toBe('5');

    await page.fill('#activity-title-input', 'Max Sets Test');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('a Sets value saved out of range by something other than the stepper (e.g. a hand-edited import) is still rejected on save', async ({ page }) => {
    // saveActivity() keeps its own 1-5 validation as a backstop for data
    // the stepper itself could never produce, since Sets can still arrive
    // out of range via imported/pasted JSON.
    await page.fill('#activity-title-input', 'Bad Import Test');
    await page.evaluate(() => { document.getElementById('activity-sets-input').value = '6'; });
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-sets-error')).toBeVisible();
  });

  test('Rest Between Sets must be between 0 and 5 minutes', async ({ page }) => {
    await page.fill('#activity-title-input', 'Rest Bounds Test');
    await setSetsViaStepper(page, 3); // Rest Between Sets is disabled at Sets=1
    await page.selectOption('#activity-rest-between-sets-minutes', '5');
    await page.selectOption('#activity-rest-between-sets-seconds', '1');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-rest-between-sets-error')).toBeVisible();

    await page.selectOption('#activity-rest-between-sets-seconds', '0');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('Pace / Rep must be between 0.5 and 20 seconds', async ({ page }) => {
    await page.fill('#activity-title-input', 'Pace Bounds Test');
    await page.fill('#activity-pace-input', '20.1');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-pace-error')).toBeVisible();

    await page.fill('#activity-pace-input', '20');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('Total Reps accepts up to 500 (raised from the old unvalidated-but-effectively-low bound)', async ({ page }) => {
    await page.fill('#activity-title-input', 'High Reps Test');
    await page.fill('#activity-reps-input', '501');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-reps-error')).toBeVisible();

    await page.fill('#activity-reps-input', '500');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('Exercise Timer duration accepts up to 5 hours via the h:mm:ss picker', async ({ page }) => {
    await page.selectOption('#activity-type-select', 'exercise-timer');
    await expect(page.locator('#duration-picker-long')).toBeVisible();
    await expect(page.locator('#duration-picker-short')).toBeHidden();

    await page.fill('#activity-title-input', 'Long Duration Test');
    await page.selectOption('#activity-duration-hours', '5');
    await page.selectOption('#activity-duration-minutes-long', '0');
    await page.selectOption('#activity-duration-seconds-long', '1');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-duration-error')).toBeVisible();

    await page.selectOption('#activity-duration-seconds-long', '0');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('Rest duration is capped at 5 minutes, not the Exercise Timer 5-hour cap', async ({ page }) => {
    await page.selectOption('#activity-type-select', 'rest');
    await expect(page.locator('#duration-picker-short')).toBeVisible();
    await expect(page.locator('#duration-picker-long')).toBeHidden();

    await page.fill('#activity-title-input', 'Rest Duration Test');
    await page.selectOption('#activity-duration-minutes-short', '5');
    await page.selectOption('#activity-duration-seconds-short', '1');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-duration-error')).toBeVisible();

    await page.selectOption('#activity-duration-seconds-short', '0');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });

  test('a 0-second duration is rejected with an inline error, not silently clamped', async ({ page }) => {
    await page.selectOption('#activity-type-select', 'rest');
    await page.fill('#activity-title-input', 'Zero Duration Test');
    await page.selectOption('#activity-duration-minutes-short', '0');
    await page.selectOption('#activity-duration-seconds-short', '0');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(200);
    await expect(page.locator('#activity-duration-error')).toBeVisible();
    await expect(page.locator('#activity-modal')).toBeVisible();

    await page.selectOption('#activity-duration-seconds-short', '1');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
    await expect(page.locator('#activity-modal')).toBeHidden();
  });
});

test.describe('Activity card summary', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('shows "N sets x M reps" for a multi-set activity, unchanged "@ pace" text for a single-set one', async ({ page }) => {
    await seedSetsRoutine(page, [
      { id: 'a1', type: 'reps', title: 'Multi Set', reps: 10, pace: 2, sets: 3, restBetweenSets: 45 },
      { id: 'a2', type: 'reps', title: 'Single Set', reps: 10, pace: 2, sets: 1, restBetweenSets: 0 }
    ]);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);

    const multiSetDesc = await page.locator('#activity-list-container .item-card', { hasText: 'Multi Set' }).locator('.item-description').textContent();
    const singleSetDesc = await page.locator('#activity-list-container .item-card', { hasText: 'Single Set' }).locator('.item-description').textContent();

    expect(multiSetDesc.trim()).toBe('3 sets x 10 reps');
    expect(singleSetDesc.trim()).toBe('10 reps @ 2s/rep');
  });
});

test.describe('Favorites matching includes Sets / Rest Between Sets', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await page.click('#routines-container .item-card button[title="Edit"]');
    await page.waitForTimeout(300);
    await page.click('#btn-add-activity');
    await page.waitForTimeout(300);
    await page.fill('#activity-title-input', 'Favorite Sets Test');
    await page.click('#btn-favorite-toggle');
    await page.click('#btn-save-activity');
    await page.waitForTimeout(300);
  });

  test('editing Sets on an already-favorited activity un-matches it, editing it back re-matches', async ({ page }) => {
    await page.locator('#activity-list-container .item-card', { hasText: 'Favorite Sets Test' }).locator('button[title="Edit Activity"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');

    await setSetsViaStepper(page, 3);
    await page.waitForTimeout(100);
    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'false');

    await setSetsViaStepper(page, 1);
    await page.waitForTimeout(100);
    await expect(page.locator('#btn-favorite-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.click('#btn-cancel-activity');
    await page.waitForTimeout(400);
  });
});

test.describe('Execution engine: multi-set Reps activity', () => {
  test('walks through every set and the rest between them, emphasizes the final set, and does not rest after it', async ({ page }) => {
    await resetApp(page);
    await seedSetsRoutine(page, [
      { id: 'a1', type: 'reps', title: 'Test Squats', reps: 2, pace: 2, sets: 3, restBetweenSets: 5 },
      { id: 'a2', type: 'rest', title: 'Final Rest', duration: 1 }
    ]);
    await stubSpeechAndReturnCalls(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => executionEngine.stopLoop());

    // Set 1, rep 1.
    expect(await page.textContent('#counter-sub')).toBe('Set 1 of 3: Rep 1 of 2');
    let speakCalls = await page.evaluate(() => window.__speakCalls);
    expect(speakCalls[0]).toBe('Test Squats, set 1 of 3. Begin.');

    // Rep 1 -> rep 2 of set 1.
    await forceAdvance(page);
    expect(await page.textContent('#counter-sub')).toBe('Set 1 of 3: Rep 2 of 2');
    expect(await page.evaluate(() => executionEngine.subState)).toBe('WORK');

    // Set 1 complete -> rest between sets, previewing set 2.
    await forceAdvance(page);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('SET_REST');
    expect(await page.evaluate(() => executionEngine.currentSet)).toBe(2);
    expect(await page.textContent('#player-status-badge')).toBe('REST');
    expect(await page.textContent('#counter-sub')).toBe('Rest Between Sets');
    expect(await page.textContent('#next-up-preview')).toBe('Next: Test Squats, set 2 of 3.');

    // Rest expires -> set 2, rep 1, not the last set.
    await forceAdvance(page);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('WORK');
    expect(await page.textContent('#counter-sub')).toBe('Set 2 of 3: Rep 1 of 2');
    speakCalls = await page.evaluate(() => window.__speakCalls);
    expect(speakCalls).toContain('Test Squats, set 2 of 3. Begin.');

    // Rep 1 -> rep 2 of set 2, then set 2 complete -> rest, previewing set 3.
    await forceAdvance(page);
    await forceAdvance(page);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('SET_REST');
    expect(await page.evaluate(() => executionEngine.currentSet)).toBe(3);
    expect(await page.textContent('#next-up-preview')).toBe('Next: Test Squats, set 3 of 3.');

    // Rest expires -> set 3 (the final set) gets "Last set."/"Final set." emphasis.
    await forceAdvance(page);
    expect(await page.textContent('#counter-sub')).toBe('Set 3 of 3: Rep 1 of 2');
    speakCalls = await page.evaluate(() => window.__speakCalls);
    const finalAnnouncement = speakCalls.find((call) => call.startsWith('Test Squats, set 3 of 3.'));
    expect(finalAnnouncement).toMatch(/^Test Squats, set 3 of 3\. (Last set|Final set)\. Begin\.$/);

    // Rep 1 -> rep 2 of the final set, then it completes -> straight to the
    // next Activity, with NO rest after the final set.
    await forceAdvance(page);
    await forceAdvance(page);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('REST');
    expect(await page.evaluate(() => executionEngine.activityIndex)).toBe(1);
    expect(await page.textContent('#current-title')).toBe('Final Rest');
  });

  test('Skip during a set jumps to its rest; Skip during that rest jumps straight into the next set', async ({ page }) => {
    await resetApp(page);
    await seedSetsRoutine(page, [
      { id: 'a1', type: 'reps', title: 'Skip Test', reps: 5, pace: 2, sets: 3, restBetweenSets: 5 }
    ]);
    await stubSpeechAndReturnCalls(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => executionEngine.stopLoop());
    expect(await page.evaluate(() => executionEngine.currentRep)).toBe(1);

    // Skip mid-set-1 (only on rep 1 of 5) -> its rest, not the next Activity.
    await page.click('#btn-skip');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('SET_REST');
    expect(await page.evaluate(() => executionEngine.currentSet)).toBe(2);

    // Skip the rest -> straight into set 2's work phase.
    await page.click('#btn-skip');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('WORK');
    expect(await page.evaluate(() => executionEngine.currentSet)).toBe(2);
    expect(await page.evaluate(() => executionEngine.currentRep)).toBe(1);
  });

  test('Rest Between Sets = 0 runs sets back-to-back with no SET_REST phase', async ({ page }) => {
    await resetApp(page);
    await seedSetsRoutine(page, [
      { id: 'a1', type: 'reps', title: 'Back To Back', reps: 1, pace: 2, sets: 2, restBetweenSets: 0 }
    ]);
    await stubSpeechAndReturnCalls(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => executionEngine.stopLoop());
    expect(await page.evaluate(() => executionEngine.currentSet)).toBe(1);

    // Set 1's only rep completes -> straight into set 2, never SET_REST.
    await forceAdvance(page);
    expect(await page.evaluate(() => executionEngine.subState)).toBe('WORK');
    expect(await page.evaluate(() => executionEngine.currentSet)).toBe(2);
    expect(await page.textContent('#counter-sub')).toBe('Set 2 of 2: Rep 1 of 1');
  });
});
