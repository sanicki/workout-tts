const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

// Regression coverage for a bug where a stopped routine kept running in the
// background. Root cause: stop() clears the tick interval and calls
// stopSpeech() (speechSynthesis.cancel()), but a cancelled utterance still
// fires its onend/onerror handler - and that handler (the continuation
// setupRepsPhase/setupExerciseTimerPhase hand to speak()) had no way to
// know the routine had been stopped, so it called startLoop() again,
// silently resuming the countdown after the player was already hidden.
test.describe('Execution engine: Stop', () => {
  test('a Stop press invalidates a pending speech callback so it cannot resume the timer', async ({ page }) => {
    await resetApp(page);

    // Replace audioEngine.speak with a stub that captures the
    // onEndCallback instead of driving it through the real (slow, and in
    // a headless sandbox unreliable) speechSynthesis API. This lets the
    // test deterministically simulate the exact race: the callback firing
    // strictly after stop() has already run.
    await page.evaluate(() => {
      window.__capturedSpeakCallback = null;
      audioEngine.speak = (text, priority, onEndCallback) => {
        if (onEndCallback) window.__capturedSpeakCallback = onEndCallback;
      };
    });

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await expect(page.locator('#player-view')).toBeVisible();

    const hadCallback = await page.evaluate(() => typeof window.__capturedSpeakCallback === 'function');
    expect(hadCallback).toBe(true);

    await page.click('#btn-stop');
    await page.waitForTimeout(100);
    await expect(page.locator('#player-view')).toBeHidden();
    const timerAfterStop = await page.evaluate(() => executionEngine.timer);
    expect(timerAfterStop).toBeNull();

    // Simulate the cancelled utterance's onend firing late, after Stop.
    const timerAfterStaleCallback = await page.evaluate(() => {
      window.__capturedSpeakCallback();
      return executionEngine.timer;
    });

    expect(timerAfterStaleCallback).toBeNull();
    await expect(page.locator('#player-view')).toBeHidden();
  });
});
