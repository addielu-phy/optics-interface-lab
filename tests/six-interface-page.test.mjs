import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import axe from 'axe-core';

const expectedTitle = '六界面光路實驗｜光的界面實驗室';
const expectedProductionRoot = process.env.EXPECTED_URL?.replace(/\/$/, '');
const artifactDir = resolve('qa-artifacts');
await mkdir(artifactDir, { recursive: true });

function startServer() {
  return new Promise((resolveServer, reject) => {
    const child = spawn(process.execPath, ['scripts/serve.mjs', '0'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`server readiness timeout: ${stderr}`)), 10000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/SERVER_URL=(http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolveServer({ child, url: match[1] });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited ${code}: ${stderr}`));
    });
  });
}

const local = process.env.BASE_URL ? null : await startServer();
const baseRoot = (process.env.BASE_URL || local.url).replace(/\/$/, '');
if (expectedProductionRoot) assert.equal(baseRoot, expectedProductionRoot, 'standalone QA must use intended production root');
const pageUrl = `${baseRoot}/six-interface.html`;
console.log(`STANDALONE_QA_URL=${pageUrl}`);

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browserPath = process.env.BROWSER_PATH || (existsSync(edgePath) ? edgePath : null);
const browser = await chromium.launch({
  headless: true,
  ...(browserPath ? { executablePath: browserPath } : {}),
});

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 1000 },
  { name: 'breakpoint-wide-761', width: 761, height: 900 },
  { name: 'breakpoint-stack-760', width: 760, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 800 },
];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });

    const response = await page.goto(`${pageUrl}?qa=${Date.now()}-${viewport.name}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, `${viewport.name}: standalone HTTP status`);
    assert.equal(await page.title(), expectedTitle, `${viewport.name}: standalone page identity`);
    await page.waitForSelector('[data-layer-page-ready="true"]');

    const layout = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { top: rect.top + scrollY, bottom: rect.bottom + scrollY, width: rect.width, height: rect.height };
      };
      const markers = [...document.querySelectorAll('#layer-scene marker')].map((marker) => ({
        id: marker.id,
        units: marker.getAttribute('markerUnits'),
        width: Number(marker.getAttribute('markerWidth')),
        height: Number(marker.getAttribute('markerHeight')),
      }));
      const targets = [...document.querySelectorAll('a, button, input')]
        .filter((element) => !element.disabled && getComputedStyle(element).display !== 'none')
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { id: element.id || element.textContent.trim(), width: rect.width, height: rect.height };
        });
      return {
        clientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        angle: box('#standalone-angle-panel'),
        result: box('#layer-result-banner'),
        figure: box('#standalone-ray-result'),
        settings: box('#standalone-medium-settings'),
        markers,
        targets,
        inputCount: document.querySelectorAll('[data-layer-index]').length,
        eventCount: document.querySelectorAll('#layer-event-body tr').length,
      };
    });

    assert.equal(layout.clientWidth, viewport.width, `${viewport.name}: exact viewport width`);
    assert.equal(layout.rootScrollWidth, viewport.width, `${viewport.name}: root horizontal overflow`);
    assert.equal(layout.bodyScrollWidth, viewport.width, `${viewport.name}: body horizontal overflow`);
    assert.ok(layout.angle.bottom <= layout.result.top + 1, `${viewport.name}: result status must follow angle control`);
    assert.ok(layout.result.bottom <= layout.figure.top + 1, `${viewport.name}: ray diagram must follow result status`);
    assert.ok(layout.result.top - layout.angle.bottom <= 28, `${viewport.name}: result is not directly below angle control`);
    assert.ok(layout.figure.top - layout.result.bottom <= 20, `${viewport.name}: ray diagram is not directly below result status`);
    assert.ok(layout.figure.bottom <= layout.settings.top + 1, `${viewport.name}: medium settings must come after the ray result`);
    assert.equal(layout.inputCount, 7, `${viewport.name}: seven medium inputs`);
    assert.equal(layout.eventCount, 6, `${viewport.name}: six interface results`);
    assert.equal(layout.markers.length, 3, `${viewport.name}: three directional markers`);
    assert.equal(layout.markers.every((marker) => marker.units === 'userSpaceOnUse'), true, `${viewport.name}: arrowheads must not scale with stroke width`);
    assert.equal(layout.markers.every((marker) => marker.width <= 16 && marker.height <= 16), true, `${viewport.name}: arrowheads must stay proportional`);
    assert.deepEqual(layout.targets.filter((target) => target.width < 43.5 || target.height < 43.5), [], `${viewport.name}: undersized controls`);

    await page.addScriptTag({ content: axe.source });
    const accessibility = await page.evaluate(async () => globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    }));
    assert.deepEqual(accessibility.violations, [], `${viewport.name}: axe violations`);

    if (viewport.name === 'desktop-1440') {
      const beforePath = await page.locator('#layer-rays .layer-primary-ray').first().getAttribute('d');
      assert.equal(await page.evaluate(() => window.__SIX_INTERFACE_LAB__.setAngle(45)), true);
      const afterPath = await page.locator('#layer-rays .layer-primary-ray').first().getAttribute('d');
      assert.notEqual(afterPath, beforePath, 'angle changes must update the ray path immediately');
      const deepTir = await page.evaluate(() => window.__SIX_INTERFACE_LAB__.snapshot);
      assert.equal(deepTir.termination, 'total-internal-reflection');
      assert.equal(deepTir.terminatedAt, 'E');

      assert.equal(await page.evaluate(() => window.__SIX_INTERFACE_LAB__.setIndices(Array(7).fill(1.5))), true);
      assert.equal(await page.evaluate(() => window.__SIX_INTERFACE_LAB__.setAngle(60)), true);
      assert.equal(await page.locator('#layer-rays .layer-reflection-ray').count(), 0, 'equal media must not draw zero-energy reflections');

      const hostile = await page.evaluate(() => {
        const api = window.__SIX_INTERFACE_LAB__;
        const before = JSON.stringify(api.snapshot);
        const angleResults = [NaN, Infinity, -1, 75.1, '45', null, {}, []].map((value) => {
          try { return api.setAngle(value); } catch { return 'threw'; }
        });
        const indexResults = [null, [], [1, 1], Array(7).fill(0.9), Array(7).fill('1.5'), Array(7).fill(NaN)].map((value) => {
          try { return api.setIndices(value); } catch { return 'threw'; }
        });
        const descriptor = Object.getOwnPropertyDescriptor(window, '__SIX_INTERFACE_LAB__');
        return { before, after: JSON.stringify(api.snapshot), angleResults, indexResults, frozen: Object.isFrozen(api), descriptor };
      });
      assert.deepEqual(hostile.angleResults, Array(8).fill(false));
      assert.deepEqual(hostile.indexResults, Array(6).fill(false));
      assert.equal(hostile.after, hostile.before);
      assert.equal(hostile.frozen, true);
      assert.equal(hostile.descriptor.writable, false);
      assert.equal(hostile.descriptor.configurable, false);
    }

    await page.screenshot({ path: resolve(artifactDir, `standalone-${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${viewport.name}: browser errors ${JSON.stringify(errors)}`);
    await context.close();
    console.log(`PASS standalone-${viewport.name}`);
  }
  console.log(`PASS standalone six-interface page (${viewports.length} viewports)`);
} finally {
  await browser.close();
  if (local) local.child.kill();
}
