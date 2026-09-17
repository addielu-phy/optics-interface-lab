import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import axe from 'axe-core';

const expectedTitle = '光的界面實驗室｜折射與全反射';
const expectedProductionUrl = process.env.EXPECTED_URL?.replace(/\/$/, '');
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
const baseUrl = (process.env.BASE_URL || local.url).replace(/\/$/, '');
if (expectedProductionUrl) assert.equal(baseUrl, expectedProductionUrl, 'QA must run against the intended production URL');
console.log(`QA_BASE_URL=${baseUrl}`);
console.log(`QA_ARTIFACT_DIR=${artifactDir}`);

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
const report = { baseUrl, viewports: [], interaction: {}, generatedAt: new Date().toISOString() };

async function assertLayout(page, viewport) {
  const geometry = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll('button, select, input, a[href]')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, text: element.textContent?.trim().slice(0, 35), width: rect.width, height: rect.height };
      });
    const visibleSvgText = [...document.querySelectorAll('#optics-scene text')]
      .filter((text) => text.getClientRects().length && getComputedStyle(text).display !== 'none')
      .map((text) => {
        const ctm = text.getScreenCTM();
        const font = parseFloat(getComputedStyle(text).fontSize);
        const box = text.getBBox();
        return {
          text: text.textContent,
          fontPx: ctm ? font * Math.hypot(ctm.c, ctm.d) : 0,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
      });
    const svg = document.getElementById('optics-scene').getBoundingClientRect();
    const overflowers = [...document.querySelectorAll('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '', left: rect.left, right: rect.right, width: rect.width };
    }).filter((item) => item.left < -0.5 || item.right > document.documentElement.clientWidth + 0.5);
    const orderIds = ['lab', 'layer-challenge'];
    const order = orderIds.map((id) => document.getElementById(id).offsetTop);
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      interactive,
      visibleSvgText,
      overflowers,
      svg: { width: svg.width, height: svg.height },
      order,
      ready: document.body.dataset.appReady,
    };
  });
  assert.equal(geometry.clientWidth, viewport.width, `${viewport.name}: wrong client width`);
  assert.equal(geometry.scrollWidth, geometry.clientWidth, `${viewport.name}: horizontal overflow ${JSON.stringify(geometry.overflowers)}`);
  assert.equal(geometry.ready, 'true', `${viewport.name}: app ready sentinel`);
  assert.ok(geometry.svg.width > 200 && geometry.svg.height > 150, `${viewport.name}: SVG has useful dimensions`);
  assert.ok(geometry.order[1] > geometry.order[0], `${viewport.name}: challenge must follow lab`);
  const undersized = geometry.interactive.filter((item) => item.height < 43.5 || item.width < 43.5);
  assert.deepEqual(undersized, [], `${viewport.name}: undersized targets ${JSON.stringify(undersized)}`);
  assert.ok(geometry.visibleSvgText.length > 0, `${viewport.name}: no visible SVG teaching text`);
  const tinyText = geometry.visibleSvgText.filter((item) => item.fontPx < 13.9);
  assert.deepEqual(tinyText, [], `${viewport.name}: SVG text below 14px ${JSON.stringify(tinyText)}`);
  for (const item of geometry.visibleSvgText) {
    assert.ok(item.box.x >= -1 && item.box.y >= -1 && item.box.x + item.box.width <= 901 && item.box.y + item.box.height <= 561,
      `${viewport.name}: SVG label clipped: ${item.text}`);
  }
  return geometry;
}

async function assertAccessibility(page, viewport) {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () => globalThis.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }));
  assert.deepEqual(results.violations, [], `${viewport.name}: axe violations ${JSON.stringify(results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })))}`);
  return { violations: 0, incomplete: results.incomplete.map((entry) => ({ id: entry.id, nodes: entry.nodes.length })) };
}

async function runInteractions(page) {
  const initial = await page.evaluate(() => window.__OPTICS_LAB__.snapshot);
  assert.equal(initial.totalInternalReflection, true, 'default glass-to-air scene should demonstrate TIR');

  assert.equal(await page.evaluate(() => window.__OPTICS_LAB__.setAngle(30)), true);
  assert.equal(await page.evaluate(() => window.__OPTICS_LAB__.snapshot.totalInternalReflection), false);
  assert.match(await page.locator('#result-title').textContent(), /離法線偏折/);

  await page.locator('#angle-range').evaluate((element) => {
    element.value = '35.4';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => window.__OPTICS_LAB__.snapshot.incidentDeg), 35.4);

  const sourceHandle = page.locator('#source-handle');
  await sourceHandle.scrollIntoViewIfNeeded();
  const sourceBox = await sourceHandle.boundingBox();
  assert.ok(sourceBox, 'drag handle must have a bounding box');
  const beforeDragAngle = await page.evaluate(() => window.__OPTICS_LAB__.snapshot.incidentDeg);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 - 70, sourceBox.y + sourceBox.height / 2 + 25, { steps: 6 });
  await page.mouse.up();
  const afterDragAngle = await page.evaluate(() => window.__OPTICS_LAB__.snapshot.incidentDeg);
  assert.notEqual(afterDragAngle, beforeDragAngle, 'dragging the light source must change the incident angle');

  assert.equal(await page.evaluate(() => window.__OPTICS_LAB__.setAngle(50)), true);
  assert.equal(await page.evaluate(() => window.__OPTICS_LAB__.snapshot.totalInternalReflection), true);
  assert.equal(await page.locator('#transmitted-ray').getAttribute('hidden'), '');

  await page.locator('#swap-media').click();
  const swapped = await page.evaluate(() => window.__OPTICS_LAB__.snapshot);
  assert.ok(swapped.n1 < swapped.n2);
  assert.equal(swapped.totalInternalReflection, false);
  assert.match(await page.locator('#result-title').textContent(), /向法線偏折/);

  await page.locator('[data-preset="straw"]').click();
  const straw = await page.evaluate(() => window.__OPTICS_LAB__.snapshot);
  assert.equal(straw.n1, 1.0003);
  assert.equal(straw.n2, 1.333);
  assert.equal(straw.totalInternalReflection, false);

  await page.locator('[data-boundary="2"]').click();
  const layerC = await page.evaluate(() => window.__OPTICS_LAB__.snapshot);
  assert.equal(layerC.n1, 1.3);
  assert.equal(layerC.n2, 1.6);
  assert.equal(layerC.totalInternalReflection, false);

  await page.locator('[data-boundary="0"]').click();
  const layerA = await page.evaluate(() => window.__OPTICS_LAB__.snapshot);
  assert.equal(layerA.n1, 1.7);
  assert.equal(layerA.n2, 1.5);
  assert.equal(layerA.totalInternalReflection, true);

  await page.locator('#reveal-answer').click();
  assert.equal(await page.locator('#challenge-answer').isVisible(), true);
  assert.match(await page.locator('#challenge-answer').textContent(), /A、B、D、E/);

  const beforeInvalid = await page.evaluate(() => JSON.stringify(window.__OPTICS_LAB__.snapshot));
  await page.locator('#incident-custom').fill('');
  await page.waitForTimeout(50);
  const afterInvalid = await page.evaluate(() => JSON.stringify(window.__OPTICS_LAB__.snapshot));
  assert.equal(afterInvalid, beforeInvalid, 'invalid input must retain the last valid snapshot');
  assert.notEqual((await page.locator('#validation-status').textContent()).trim(), '');
  assert.equal(await page.locator('#incident-custom').getAttribute('aria-invalid'), 'true');
  await page.locator('#incident-custom').fill('1.7');
  await page.waitForTimeout(160);
  assert.equal((await page.locator('#validation-status').textContent()).trim(), '');

  const hostile = await page.evaluate(() => {
    const api = window.__OPTICS_LAB__;
    const before = JSON.stringify(api.snapshot);
    const values = [NaN, Infinity, -1, 90, '50', null, true, {}, []];
    const results = values.map((value) => {
      try { return api.setAngle(value); } catch { return 'threw'; }
    });
    const descriptor = Object.getOwnPropertyDescriptor(window, '__OPTICS_LAB__');
    return { before, after: JSON.stringify(api.snapshot), results, frozen: Object.isFrozen(api), descriptor };
  });
  assert.deepEqual(hostile.results, Array(9).fill(false));
  assert.equal(hostile.after, hostile.before);
  assert.equal(hostile.frozen, true);
  assert.equal(hostile.descriptor.writable, false);
  assert.equal(hostile.descriptor.configurable, false);

  return { defaultTir: true, swap: 'pass', layers: 'pass', invalidStateRetention: 'pass', hostileApi: 'pass' };
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });

    const joiner = baseUrl.includes('?') ? '&' : '?';
    const response = await page.goto(`${baseUrl}${joiner}qa=${Date.now()}-${viewport.name}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, `${viewport.name}: HTTP status`);
    assert.equal(await page.title(), expectedTitle, `${viewport.name}: page identity`);
    await page.waitForSelector('[data-app-ready="true"]');

    const geometry = await assertLayout(page, viewport);
    const accessibility = await assertAccessibility(page, viewport);
    if (viewport.name === 'desktop-1440') {
      report.interaction = await runInteractions(page);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('[data-app-ready="true"]');
    }
    await page.screenshot({ path: resolve(artifactDir, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${viewport.name}: browser errors ${JSON.stringify(errors)}`);
    report.viewports.push({ name: viewport.name, clientWidth: geometry.clientWidth, scrollWidth: geometry.scrollWidth, svgTextMinPx: Math.min(...geometry.visibleSvgText.map((item) => item.fontPx)), accessibility });
    await context.close();
    console.log(`PASS ${viewport.name}`);
  }
  await writeFile(resolve(artifactDir, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS all browser QA (${viewports.length} viewports)`);
} finally {
  await browser.close();
  if (local) local.child.kill();
}
