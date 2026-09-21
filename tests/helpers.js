// Shared setup for specs: loads the app with a clean localStorage so every
// test starts from the same default-seeded state, regardless of test order.
async function resetApp(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
}

module.exports = { resetApp };
