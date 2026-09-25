import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = process.env.PIPELINE_URL || 'http://localhost:3001';
const run = '86dab5e0-9793-4cb4-8a1a-5c9c7f0c04f6';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/pipeline', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.action === 'cue-review') { body.review.reviewer = 'automated'; return route.continue({ postData: JSON.stringify(body) }); }
    }
    return route.continue();
  });
  await page.goto(`${base}/pipeline?run=${run}`);
  await page.getByText('Audio references ready', { exact: false }).waitFor({ timeout: 60000 });
  const study = await (await page.request.get(`${base}/api/pipeline?run=${run}&view=movement`)).json();
  assert.equal(study.analysis.runId, run);
  assert.equal(study.analysis.status, 'draft');
  const field = page.getByRole('img', { name: 'Dance hypothesis brightness', exact: true });
  async function seek(t) {
    await page.getByRole('slider', { name: 'Scrub lighting comparison' }).fill(String(t));
    await page.waitForFunction(t => {
      const v = document.querySelector('video');
      return v && !v.seeking && Math.abs(v.currentTime - t) < .01 && !document.querySelector('.pl-video-top')?.textContent.includes('WAITING');
    }, t);
  }
  await seek(3);
  const at = await page.locator('.pl-inspector dl > div').filter({ hasText: 'Frame timestamp' }).locator('dd').textContent();
  const t = Number(at.replace(' s', ''));
  const expected = study.analysis.frames.find(f => Math.abs(f.t-t) < .001);
  assert.ok(expected && expected.punctuation !== null);
  assert.ok(Math.abs(Number(await field.getAttribute('data-value')) - expected.punctuation) < 1e-8);
  await page.getByLabel('Dance brightness mapping').selectOption('flow');
  assert.ok(Math.abs(Number(await field.getAttribute('data-value')) - expected.flow) < 1e-8);
  assert.notEqual(await page.getByRole('img', { name: 'Stereo-scope reference brightness', exact: true }).getAttribute('data-value'), 'missing');
  await seek(0);
  assert.equal(await field.getAttribute('data-value'), 'missing', 'segment boundary must not become a darkness target');
  await page.locator('.pl-cue-list button').first().click();
  const text = 'Automated QA only: verified cue review persistence. No movement or lighting judgment.';
  await page.getByLabel('Movement cue evidence').fill(text);
  if (!study.reviews.some(r => r.analysisId === study.analysis.id && r.text === text)) {
    await page.getByRole('button', { name: 'Save cue review', exact: true }).click();
  }
  await page.locator('.pl-cue-record').getByText(text, { exact: true }).waitFor();
  assert.ok((await page.locator('.pl-cue-list button').first().textContent()).includes('Unreviewed'));
  const invalid = await page.request.post(`${base}/api/pipeline`, { headers: { Origin: base }, data: { action: 'cue-review', run, review: { analysisId: study.analysis.id, candidateId: 'nonexistent', judgment: 'keep', reviewer: 'automated', text } } });
  assert.equal(invalid.status(), 400);
  await page.reload();
  await page.getByText('Audio references ready', { exact: false }).waitFor({ timeout: 60000 });
  await page.locator('.pl-cue-list button').first().click();
  await page.locator('.pl-cue-record').getByText(text, { exact: true }).waitFor();
  await seek(3);
  await page.getByRole('button', { name: 'Play comparison', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 3.4);
  await page.getByRole('button', { name: 'Pause comparison', exact: true }).click();
  const before = Number(await page.getByRole('slider', { name: 'Scrub video and audio' }).inputValue());
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await page.waitForFunction(before => document.querySelector('video')?.currentTime > before, before);
  await seek(3);
  assert.ok((await page.getByLabel('Brightness beside the video').textContent()).includes(expected.punctuation.toFixed(3)));
  await page.screenshot({ path: '/private/tmp/lightflow-movement-desktop.png', fullPage: true });
  await page.locator('.pl-movement').screenshot({ path: '/private/tmp/lightflow-movement-panel.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.pl-movement').screenshot({ path: '/private/tmp/lightflow-movement-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['saved analysis', 'decoded audio comparisons', 'exact frame-matched projection', 'mapping switch', 'missing boundary stays null', 'cue review persistence', 'automated review excluded', 'invalid cue rejected', 'playback and frame stepping', 'responsive layout'], analysis: study.analysis.id }));
} finally { await browser.close(); }
