const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

// Coverage for the playback notification: the Settings opt-in/permission
// flow, phase-transition-only content updates (reusing the exact in-app
// status text so the two can't drift), the Skip/Pause action relay from
// the service worker back into the page, and closing on Stop.
test.use({ permissions: ['notifications'] });

async function enableNotifications(page) {
  await page.click('#tab-settings');
  await page.waitForTimeout(200);
  await page.click('#chk-playback-notifications + .switch-track');
  // Waits for the actual persisted state rather than a fixed delay - the
  // toggle click kicks off an async Notification.requestPermission() ->
  // saveSettings() chain, and a fixed short wait proved too tight on a
  // slower/colder CI runner, leaving state.settings.playbackNotifications
  // still false (and playbackNotification.update()'s own "not enabled"
  // guard silently short-circuiting) by the time a test proceeded.
  await page.waitForFunction(() => state.settings.playbackNotifications === true);
}

async function seedRoutineAndReload(page, activities) {
  await page.evaluate((activities) => {
    state.routines = [{ id: 'notif-test-routine', name: 'Notif Test Routine', activities }];
    saveRoutines();
  }, activities);
  await page.reload();
  await page.waitForTimeout(300);
}

// Replaces playbackNotification.update/close with recording stubs and
// audioEngine.speak with a synchronous one, exactly like the execution-
// engine tests elsewhere in this suite - lets phase transitions be driven
// deterministically without real speech or real OS notifications.
async function stubAndRecord(page) {
  await page.evaluate(() => {
    window.__notifCalls = [];
    playbackNotification.update = async (title, body, isPaused) => {
      window.__notifCalls.push({ type: 'update', title, body, isPaused });
    };
    playbackNotification.close = async () => {
      window.__notifCalls.push({ type: 'close' });
    };
    audioEngine.speak = (text, priority, cb) => { if (cb) cb(); };
  });
}

// Forces the execution engine's phase timer to expire on the next tick, so
// phase transitions can be driven deterministically without depending on
// real wall-clock time or the real 100ms setInterval loop.
async function forceAdvance(page) {
  await page.evaluate(() => {
    executionEngine.accTime = -1;
    executionEngine.lastTime = performance.now();
    executionEngine.tick();
    executionEngine.stopLoop();
  });
}

test.describe('Playback notification: Settings opt-in', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('enabling requests permission and persists when granted', async ({ page }) => {
    await expect(page.locator('#chk-playback-notifications')).not.toBeChecked();
    await enableNotifications(page);
    await expect(page.locator('#chk-playback-notifications')).toBeChecked();
    const persisted = await page.evaluate(() => state.settings.playbackNotifications);
    expect(persisted).toBe(true);
  });

  test('disabling does not request permission and persists false', async ({ page }) => {
    await enableNotifications(page);
    await page.click('#chk-playback-notifications + .switch-track');
    await page.waitForTimeout(200);
    await expect(page.locator('#chk-playback-notifications')).not.toBeChecked();
    const persisted = await page.evaluate(() => state.settings.playbackNotifications);
    expect(persisted).toBe(false);
  });

  test('a denied permission reverts the toggle and does not persist true', async ({ page }) => {
    await page.evaluate(() => {
      Notification.requestPermission = () => Promise.resolve('denied');
    });
    // Doesn't reuse enableNotifications() - that helper waits for
    // playbackNotifications to become true, which never happens on this
    // (denied) path.
    await page.click('#tab-settings');
    await page.waitForTimeout(200);
    await page.click('#chk-playback-notifications + .switch-track');
    await expect(page.locator('#chk-playback-notifications')).not.toBeChecked();
    const persisted = await page.evaluate(() => state.settings.playbackNotifications);
    expect(persisted).toBe(false);
    await expect(page.locator('.snackbar-container')).toContainText('Notification permission was not granted');
  });
});

test.describe('Playback notification: showNotification()/close() call shape', () => {
  // Exercises the real playbackNotification.update()/close(), but replaces
  // navigator.serviceWorker.ready itself with a promise resolving to a
  // plain fake registration object, instead of reading real notifications
  // back via a real ServiceWorkerRegistration's getNotifications(). Two
  // earlier attempts at patching showNotification/getNotifications - first
  // on the specific instance playbackNotification resolves, then on
  // ServiceWorkerRegistration.prototype - both failed identically on CI
  // (the patched function was never invoked), which points to those being
  // non-writable own properties on whatever real registration object CI's
  // Chromium build hands back. A fully fake registration sidesteps that
  // platform quirk entirely - there's no real ServiceWorkerRegistration
  // involved to have surprising property semantics.
  test('update() calls showNotification with the right title/body/tag/actions; close() closes matching-tag notifications', async ({ page }) => {
    await resetApp(page);
    await enableNotifications(page);

    const result = await page.evaluate(async () => {
      const fakeReg = { _showCall: null, _getNotificationsTagArg: null, _closedCount: 0 };
      fakeReg.showNotification = (title, options) => {
        fakeReg._showCall = { title, options };
        return Promise.resolve();
      };
      fakeReg.getNotifications = (opts) => {
        fakeReg._getNotificationsTagArg = opts && opts.tag;
        return Promise.resolve([{ close: () => { fakeReg._closedCount++; } }]);
      };
      Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(fakeReg), configurable: true });

      await playbackNotification.update('Push-ups', 'Rep 1 of 10', false);
      await playbackNotification.close();

      return { showCall: fakeReg._showCall, getNotificationsTagArg: fakeReg._getNotificationsTagArg, closedCount: fakeReg._closedCount };
    });

    expect(result.showCall.title).toBe('Push-ups');
    expect(result.showCall.options).toMatchObject({
      body: 'Rep 1 of 10',
      tag: 'workout-tts-playback',
      silent: true,
      actions: [{ action: 'pause', title: 'Pause' }, { action: 'skip', title: 'Skip' }]
    });
    expect(result.getNotificationsTagArg).toBe('workout-tts-playback');
    expect(result.closedCount).toBe(1);
  });

  test('a paused Pause action shows as "Resume"', async ({ page }) => {
    await resetApp(page);
    await enableNotifications(page);

    const options = await page.evaluate(async () => {
      const fakeReg = { _captured: null };
      fakeReg.showNotification = (title, opts) => { fakeReg._captured = opts; return Promise.resolve(); };
      Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(fakeReg), configurable: true });
      await playbackNotification.update('Push-ups', 'Paused - Rep 1 of 10', true);
      return fakeReg._captured;
    });
    expect(options.actions.find(a => a.action === 'pause').title).toBe('Resume');
  });
});

test.describe('Playback notification: phase-transition content', () => {
  // A 2-set, 1-rep-per-set Reps activity followed by a Rest activity, so a
  // single forced tick always crosses exactly one phase boundary: Set 1 WORK
  // -> SET_REST -> Set 2 WORK -> next activity (REST).
  const activities = [
    { id: 'a1', type: 'reps', title: 'Squats', reps: 1, pace: 2, sets: 2, restBetweenSets: 5 },
    { id: 'a2', type: 'rest', title: 'Cooldown', duration: 3 }
  ];

  test('updates on activity/set/rest/pause transitions, matching the in-app status text', async ({ page }) => {
    await resetApp(page);
    await enableNotifications(page);
    await seedRoutineAndReload(page, activities);
    await stubAndRecord(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => executionEngine.stopLoop());

    let calls = await page.evaluate(() => window.__notifCalls);
    expect(calls).toEqual([
      { type: 'update', title: 'Squats', body: 'Set 1 of 2: Rep 1 of 1', isPaused: false }
    ]);

    // Pause / resume.
    await page.click('#btn-pause');
    await page.waitForTimeout(100);
    await page.click('#btn-pause');
    await page.waitForTimeout(100);

    calls = await page.evaluate(() => window.__notifCalls);
    expect(calls).toEqual([
      { type: 'update', title: 'Squats', body: 'Set 1 of 2: Rep 1 of 1', isPaused: false },
      { type: 'update', title: 'Squats', body: 'Paused - Set 1 of 2: Rep 1 of 1', isPaused: true },
      { type: 'update', title: 'Squats', body: 'Set 1 of 2: Rep 1 of 1', isPaused: false }
    ]);

    // Set 1's only rep completes -> SET_REST.
    await forceAdvance(page);
    // SET_REST expires -> Set 2 WORK.
    await forceAdvance(page);
    // Set 2's only rep completes -> next activity (Cooldown, REST).
    await forceAdvance(page);

    calls = await page.evaluate(() => window.__notifCalls);
    expect(calls).toEqual([
      { type: 'update', title: 'Squats', body: 'Set 1 of 2: Rep 1 of 1', isPaused: false },
      { type: 'update', title: 'Squats', body: 'Paused - Set 1 of 2: Rep 1 of 1', isPaused: true },
      { type: 'update', title: 'Squats', body: 'Set 1 of 2: Rep 1 of 1', isPaused: false },
      { type: 'update', title: 'Squats', body: 'Rest Between Sets', isPaused: false },
      { type: 'update', title: 'Squats', body: 'Set 2 of 2: Rep 1 of 1', isPaused: false },
      { type: 'update', title: 'Cooldown', body: 'Rest', isPaused: false }
    ]);
  });

  test('Skip and Pause actions relayed from the service worker drive the real execution engine', async ({ page }) => {
    await resetApp(page);
    await enableNotifications(page);
    await seedRoutineAndReload(page, activities);
    await stubAndRecord(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => executionEngine.stopLoop());
    await page.evaluate(() => { window.__notifCalls.length = 0; });

    // Skipping mid-set (sets=2) cuts the set short and moves into SET_REST,
    // same as finishing its reps would - a real, observable state change
    // driven by executionEngine.skip(), proving the relay actually reached it.
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workout-tts-notification-action', action: 'skip' }
      }));
    });
    await page.waitForTimeout(100);
    const subStateAfterSkip = await page.evaluate(() => executionEngine.subState);
    expect(subStateAfterSkip).toBe('SET_REST');

    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workout-tts-notification-action', action: 'pause' }
      }));
    });
    await page.waitForTimeout(100);
    const isPausedAfterRelay = await page.evaluate(() => executionEngine.isPaused);
    expect(isPausedAfterRelay).toBe(true);
  });

  test('Stop closes the notification', async ({ page }) => {
    await resetApp(page);
    await enableNotifications(page);
    await seedRoutineAndReload(page, activities);
    await stubAndRecord(page);

    await page.click('#routines-container .item-card button[title="Start Routine"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => executionEngine.stopLoop());
    await page.evaluate(() => { window.__notifCalls.length = 0; });

    await page.click('#btn-stop');
    await page.waitForTimeout(300);
    if (await page.isVisible('.dialog-backdrop.show')) {
      await page.click('.dialog-backdrop.show [data-action="confirm"]');
      await page.waitForTimeout(300);
    }

    const calls = await page.evaluate(() => window.__notifCalls);
    expect(calls).toEqual([{ type: 'close' }]);
  });
});

test.describe('Tick/chime muting while backgrounded', () => {
  // speechSynthesis is force-suspended by the OS/browser when the page is
  // backgrounded (nothing a web app can override), but WebAudio tones are
  // not - this is the bug being fixed. document.hidden can't be reassigned
  // directly (it's a getter on Document.prototype), so it's overridden per
  // page via Object.defineProperty.
  test('playTone creates no AudioContext oscillator while document.hidden is true', async ({ page }) => {
    await resetApp(page);

    const hiddenCallMade = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      let contextRequested = false;
      audioEngine.getAudioContext = () => { contextRequested = true; return null; };
      audioEngine.playTick();
      return contextRequested;
    });
    expect(hiddenCallMade).toBe(false);

    const visibleCallMade = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      let contextRequested = false;
      audioEngine.getAudioContext = () => { contextRequested = true; return null; };
      audioEngine.playTick();
      return contextRequested;
    });
    expect(visibleCallMade).toBe(true);
  });
});
