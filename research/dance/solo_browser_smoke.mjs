import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.PIPELINE_URL || 'http://localhost:3001';
const run = '86dab5e0-9793-4cb4-8a1a-5c9c7f0c04f6';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // Exercise the review form without representing automated QA as human review.
  await page.route('**/api/pipeline', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.action === 'review') { body.review.reviewer = 'automated'; return route.continue({ postData: JSON.stringify(body) }); }
    }
    return route.continue();
  });
  await page.goto(`${base}/pipeline?run=${run}`);
  await page.waitForFunction(() => document.querySelector('.pl-state')?.textContent.includes('Ready for review'));
  assert.equal(await page.getByLabel('Run history').inputValue(), run);
  assert.equal(await page.getByLabel('Reference video').inputValue(), '2EnI4bnVxP0');
  const metrics = page.locator('.pl-metrics');
  assert.ok((await metrics.textContent()).includes('99%'));
  const identityBefore = await metrics.locator('strong').last().textContent();
  await page.locator('.pl-review-form summary').click();
  await page.getByRole('button', { name: 'Use current frame', exact: true }).click();
  await page.getByLabel('Identity review evidence').fill('Automated QA only: exercised form persistence. No visual identity claim.');
  if (!await page.getByText('Automated QA only: exercised form persistence. No visual identity claim.', { exact: true }).count()) await page.getByRole('button', { name: 'Save identity check', exact: true }).click();
  await page.getByText('Automated QA only: exercised form persistence. No visual identity claim.', { exact: true }).last().waitFor();
  assert.equal(await metrics.locator('strong').last().textContent(), identityBefore);
  await page.reload();
  await page.locator('.pl-review-form summary').click();
  await page.getByText('Automated QA only: exercised form persistence. No visual identity claim.', { exact: true }).last().waitFor();
  await page.getByLabel('Reference video').selectOption('twqM56f_cVo');
  await page.waitForFunction(() => document.querySelector('.pl-metrics')?.textContent.includes('Issues flagged'));
  await page.getByLabel('Reference video').selectOption('2EnI4bnVxP0');
  await page.waitForFunction(() => document.querySelector('.pl-metrics')?.textContent.includes('99%'));
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('slider', { name: 'Scrub video and audio' }).fill('3');
  await page.waitForFunction(() => !document.querySelector('video').seeking && document.querySelector('.pl-primary-label') && Math.abs(Number([...document.querySelectorAll('.pl-inspector dl > div')].find(d => d.textContent.includes('Frame timestamp')).querySelector('dd').textContent.replace(' s','')) - document.querySelector('video').currentTime) < .06);
  await page.screenshot({ path: '/private/tmp/lightflow-solo-desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/lightflow-solo-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['run deep link', 'source switching', 'separate coverage and identity', 'review form persistence', 'automated QA excluded from identity status', 'scrub and overlay', 'desktop/mobile layout'], errors }));
} finally { await browser.close(); }
