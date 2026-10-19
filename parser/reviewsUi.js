const { getParseTiming } = require('./parseTiming');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function openReviewsSection(page, timing) {
  const t = timing || getParseTiming();
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(280);

  const tryClick = async (locator) => {
    try {
      const l = locator.first();
      if (await l.isVisible({ timeout: 900 }).catch(() => false)) {
        await l.click({ timeout: 2500 }).catch(() => {});
        await delay(t.reviewTabDelay);
        return true;
      }
    } catch (e) {

    }
    return false;
  };

  await tryClick(page.getByRole('tab', { name: /отзыв/i }));
  await tryClick(page.locator('a[href*="review"]').first());
  await tryClick(page.locator('[role="tab"]').filter({ hasText: /^Отзывы$/i }));
  await tryClick(page.locator('button, a').filter({ hasText: /^\s*Отзывы\s*(\(|\d|$)/i }));

  await page.getByRole('button', { name: /ещё отзыв|все отзывы|показать ещё|читать все/i }).first().click({ timeout: 1800 }).catch(() => {});
  await delay(t.reviewMoreDelay);

  for (let i = 0; i < t.reviewScrolls; i++) {
    await page.mouse.wheel(0, 1300);
    await delay(t.reviewWheelDelay);
  }
  await delay(t.reviewFinalDelay);
}

module.exports = { openReviewsSection };
