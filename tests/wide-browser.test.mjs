import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import axe from 'axe-core';

const expectedTitle = '六界面即時光路｜筆電・平板版';
const expectedProductionUrl = process.env.EXPECTED_URL?.replace(/\/$/, '');
const artifactDir = resolve('qa-artifacts-wide');
await mkdir(artifactDir, { recursive: true });

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function contrastRatio(colorA, colorB) {
  const [lighter, darker] = [relativeLuminance(colorA), relativeLuminance(colorB)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
}

function assertPaletteContrast() {
  const textPairs = [
    ['#12363b', '#f2eee5'], ['#12363b', '#fffdf8'],
    ['#486268', '#f2eee5'], ['#486268', '#fffdf8'],
    ['#0d6870', '#f2eee5'], ['#0d6870', '#fffdf8'],
    ['#000000', '#edf8f5'], ['#fffdf8', '#174a52'],
  ];
  assert.equal(textPairs.every(([foreground, background]) => contrastRatio(foreground, background) >= 4.5), true,
    'all tested UI and refractive-index endpoint text pairs must meet WCAG AA contrast');
  return 'pass';
}

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
const rootUrl = (process.env.BASE_URL || local.url).replace(/\/$/, '');
const baseUrl = rootUrl.endsWith('/wide') ? rootUrl : `${rootUrl}/wide`;
if (expectedProductionUrl) assert.equal(baseUrl, expectedProductionUrl, 'QA must run against the intended production URL');
console.log(`WIDE_QA_BASE_URL=${baseUrl}`);
console.log(`WIDE_QA_ARTIFACT_DIR=${artifactDir}`);

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browserPath = process.env.BROWSER_PATH || (existsSync(edgePath) ? edgePath : null);
const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
const viewports = [
  { name: 'laptop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
  { name: 'tablet-landscape-1024x768', width: 1024, height: 768 },
  { name: 'tablet-portrait-820x1180', width: 820, height: 1180 },
  { name: 'tablet-portrait-768x1024', width: 768, height: 1024 },
];
const report = { baseUrl, paletteContrast: assertPaletteContrast(), viewports: [], interaction: {}, generatedAt: new Date().toISOString() };

async function assertLayout(page, viewport) {
  const geometry = await page.evaluate(() => {
    const controls = document.querySelector('.wide-controls').getBoundingClientRect();
    const stage = document.querySelector('.wide-stage').getBoundingClientRect();
    const scene = document.getElementById('wide-scene').getBoundingClientRect();
    const incidentHit = document.getElementById('wide-incident-hit');
    const incidentCtm = incidentHit.getScreenCTM();
    const incidentHitWidth = parseFloat(getComputedStyle(incidentHit).strokeWidth)
      * (incidentCtm ? Math.hypot(incidentCtm.a, incidentCtm.b) : 0);
    const targets = [...document.querySelectorAll('button, input, a[href], summary, [role="slider"]')]
      .filter((element) => element.id !== 'wide-incident-hit')
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, text: element.textContent?.trim().slice(0, 30), width: rect.width, height: rect.height };
      });
    const overflowers = [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '', left: rect.left, right: rect.right };
      })
      .filter((item) => item.left < -0.5 || item.right > document.documentElement.clientWidth + 0.5);
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      ready: document.body.dataset.wideAppReady,
      controls: { left: controls.left, right: controls.right, top: controls.top, width: controls.width },
      stage: { left: stage.left, right: stage.right, top: stage.top, width: stage.width },
      scene: { width: scene.width, height: scene.height },
      incidentHitWidth,
      targets,
      overflowers,
      eventCount: document.querySelectorAll('.event-card').length,
    };
  });
  assert.equal(geometry.clientWidth, viewport.width, `${viewport.name}: exact viewport width`);
  assert.equal(geometry.scrollWidth, geometry.clientWidth, `${viewport.name}: horizontal overflow ${JSON.stringify(geometry.overflowers)}`);
  assert.equal(geometry.ready, 'true', `${viewport.name}: app ready sentinel`);
  assert.ok(geometry.controls.right <= geometry.stage.left + 1, `${viewport.name}: control and stage panes must be side by side`);
  assert.ok(Math.abs(geometry.controls.top - geometry.stage.top) <= 1, `${viewport.name}: panes must share top edge`);
  assert.ok(geometry.controls.width >= 250, `${viewport.name}: usable control pane width`);
  assert.ok(geometry.stage.width >= 480, `${viewport.name}: usable simulation pane width`);
  assert.ok(geometry.scene.width >= 450 && geometry.scene.height >= 300, `${viewport.name}: useful scene dimensions`);
  assert.ok(geometry.incidentHitWidth >= 43.5, `${viewport.name}: incident ray drag target is ${geometry.incidentHitWidth}px`);
  assert.equal(geometry.eventCount, 6, `${viewport.name}: six interface cards`);
  const undersized = geometry.targets.filter((target) => target.width < 43.5 || target.height < 43.5);
  assert.deepEqual(undersized, [], `${viewport.name}: undersized interactive targets ${JSON.stringify(undersized)}`);
  return geometry;
}

async function assertAccessibility(page, viewport) {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () => globalThis.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  }));
  assert.deepEqual(results.violations, [], `${viewport.name}: axe violations ${JSON.stringify(results.violations.map((entry) => ({ id: entry.id, impact: entry.impact, nodes: entry.nodes.length })))}`);
  const unexpectedIncomplete = results.incomplete
    .filter((entry) => entry.id !== 'color-contrast')
    .map((entry) => ({
      id: entry.id,
      nodes: entry.nodes.length,
      targets: entry.nodes.map((node) => ({ target: node.target, html: node.html, summary: node.failureSummary })),
    }));
  assert.deepEqual(unexpectedIncomplete, [], `${viewport.name}: unresolved axe checks ${JSON.stringify(unexpectedIncomplete)}`);
  return { violations: 0, incomplete: results.incomplete.map((entry) => entry.id) };
}

async function runInteractions(page) {
  const initial = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.snapshot);
  assert.equal(initial.events.length, 6);
  assert.equal(initial.termination, 'exited-bottom');
  assert.equal(initial.events.every((event) => event.reached), true);

  const readSceneGeometry = () => page.evaluate(() => ({
    entry: {
      x: Number(document.getElementById('wide-impact-a').getAttribute('cx')),
      y: Number(document.getElementById('wide-impact-a').getAttribute('cy')),
    },
    layers: [...document.querySelectorAll('#wide-backgrounds .layer-fill')].map((rect) => ({
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height')),
    })),
    interfaces: [...document.querySelectorAll('#wide-backgrounds .interface-line')].map((line) => ({
      x1: Number(line.getAttribute('x1')),
      y1: Number(line.getAttribute('y1')),
      x2: Number(line.getAttribute('x2')),
      y2: Number(line.getAttribute('y2')),
    })),
  }));
  const fixedGeometry = await readSceneGeometry();
  assert.deepEqual(fixedGeometry.entry, { x: 430, y: 144 }, 'interface A entry point must use the fixed pivot');
  assert.equal(fixedGeometry.layers.length, 7);
  assert.equal(fixedGeometry.layers.every((layer) => layer.width === 960 && layer.height === 64), true,
    'all media layers must keep fixed dimensions');

  const markerShape = await page.evaluate(() => [...document.querySelectorAll('#wide-scene marker')].map((marker) => ({
    id: marker.id,
    width: Number(marker.getAttribute('markerWidth')),
    height: Number(marker.getAttribute('markerHeight')),
    units: marker.getAttribute('markerUnits'),
  })));
  assert.equal(markerShape.length, 3);
  assert.equal(markerShape.every((marker) => marker.width <= 10 && marker.height <= 10 && marker.units === 'userSpaceOnUse'), true,
    `arrowheads must stay visually proportional: ${JSON.stringify(markerShape)}`);
  const directionArrows = await page.locator('#wide-rays .direction-arrow').evaluateAll((nodes) => nodes.map((node) => ({
    className: node.getAttribute('class'),
    markerEnd: node.getAttribute('marker-end'),
  })));
  assert.equal(directionArrows.filter((arrow) => arrow.className.includes('incident')).length, 1);
  assert.equal(directionArrows.filter((arrow) => arrow.className.includes('transmitted')).length, 6);
  assert.equal(directionArrows.filter((arrow) => arrow.className.includes('reflected')).length, 6);
  assert.equal(directionArrows.every((arrow) => /^url\(#wide-arrow-(incident|transmitted|reflected)\)$/.test(arrow.markerEnd)), true,
    'each rendered light-path direction segment must carry an arrowhead');

  const colorIndices = [1, 1.2, 1.4, 1.7, 2, 2.5, 3];
  assert.equal(await page.evaluate((indices) => window.__WIDE_OPTICS_LAB__.setIndices(indices), colorIndices), true);
  const colorSamples = await page.evaluate(() => {
    const layers = [...document.querySelectorAll('#wide-backgrounds .layer-fill')];
    const labels = [...document.querySelectorAll('#wide-annotations .medium-label')];
    return layers.map((layer, index) => ({
      n: Number(layer.dataset.refractiveIndex),
      depth: Number(layer.dataset.depth),
      fill: layer.getAttribute('fill').toLowerCase(),
      label: labels[index].getAttribute('fill').toLowerCase(),
    }));
  });
  assert.deepEqual(colorSamples.map((sample) => sample.n), colorIndices);
  assert.equal(colorSamples[0].fill, '#edf8f5');
  assert.equal(colorSamples.at(-1).fill, '#174a52');
  assert.equal(colorSamples.every((sample, index) => index === 0
    || relativeLuminance(sample.fill) < relativeLuminance(colorSamples[index - 1].fill)), true,
  'higher refractive indices must always render with lower luminance');
  assert.equal(colorSamples.every((sample, index) => index === 0 || sample.depth > colorSamples[index - 1].depth), true,
    'the encoded color depth must increase with refractive index');
  assert.equal(colorSamples.every((sample) => contrastRatio(sample.fill, sample.label) >= 4.5), true,
    `dynamic medium labels must remain readable: ${JSON.stringify(colorSamples)}`);
  assert.equal(await page.locator('.index-depth-scale').isVisible(), true, 'the refractive-index color legend must be visible');
  const haloCounts = await page.evaluate(() => ({
    halos: document.querySelectorAll('#wide-rays .ray-contrast-halo').length,
    coloredRays: document.querySelectorAll('#wide-rays .primary-ray, #wide-rays .reflection-ray, #wide-rays .grazing-ray').length,
  }));
  assert.deepEqual(haloCounts, { halos: haloCounts.coloredRays, coloredRays: haloCounts.coloredRays },
    'every colored light path must have a contrast halo');
  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setPreset('through')), true);

  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setAngle(45)), true);
  const deepTir = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.snapshot);
  assert.equal(deepTir.termination, 'total-internal-reflection');
  assert.equal(deepTir.terminatedAt, 'E');
  assert.equal(await page.locator('.event-card[data-interface="E"]').getAttribute('data-state'), 'tir');
  assert.equal(await page.locator('.event-card[data-interface="F"]').getAttribute('data-state'), 'blocked');
  assert.match(await page.locator('#stage-title').textContent(), /界面 E.*全反射/);
  assert.deepEqual(await readSceneGeometry(), fixedGeometry,
    'changing to 45 degrees must not move the entry point or resize the interfaces');
  await page.screenshot({ path: resolve(artifactDir, 'laptop-1440x900-tir-interface-e.png'), fullPage: true });

  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setAngle(65)), true);
  const earlyTir = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.snapshot);
  assert.equal(earlyTir.terminatedAt, 'A');
  assert.deepEqual(await readSceneGeometry(), fixedGeometry,
    'changing to 65 degrees must not move the entry point or resize the interfaces');

  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setAngle(30)), true);
  const beforeDrag = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.state.angle);
  const incidentHit = page.locator('#wide-incident-hit');
  await incidentHit.scrollIntoViewIfNeeded();
  const hitBox = await incidentHit.boundingBox();
  const hitTargetWidth = await incidentHit.evaluate((path) => {
    const ctm = path.getScreenCTM();
    return parseFloat(getComputedStyle(path).strokeWidth) * (ctm ? Math.hypot(ctm.a, ctm.b) : 0);
  });
  assert.ok(hitBox && hitTargetWidth >= 44, 'incident ray must have a large direct-drag hit target');
  await page.mouse.move(hitBox.x + hitBox.width * 0.35, hitBox.y + hitBox.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(hitBox.x + hitBox.width * 0.12, hitBox.y + hitBox.height * 0.60, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.state.angle);
  assert.notEqual(afterDrag, beforeDrag, 'directly dragging the incident ray must change the angle');
  assert.equal(Number(await page.locator('#wide-angle-range').inputValue()), afterDrag, 'slider must stay synchronized after ray drag');

  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setAngle(30)), true);
  await page.locator('#wide-source-handle').focus();
  const beforeKey = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.state.angle);
  await page.keyboard.press('ArrowUp');
  const afterKey = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.state.angle);
  assert.ok(afterKey > beforeKey, 'keyboard must adjust the draggable ray');

  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setIndices(Array(7).fill(1.5))), true);
  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setAngle(60)), true);
  const equalStack = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.snapshot);
  assert.equal(equalStack.termination, 'exited-bottom');
  assert.equal(equalStack.events.every((event) => event.reflectedPower === 0), true);
  assert.equal(equalStack.events.every((event) => event.transmittedPower === 1), true);

  const beforeInvalid = await page.evaluate(() => JSON.stringify(window.__WIDE_OPTICS_LAB__.snapshot));
  await page.locator('[data-wide-index="3"]').fill('');
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__WIDE_OPTICS_LAB__.snapshot)), beforeInvalid,
    'invalid input must retain the last valid trace');
  assert.notEqual((await page.locator('#wide-validation').textContent()).trim(), '');
  assert.equal(await page.locator('[data-wide-index="3"]').getAttribute('aria-invalid'), 'true');
  await page.locator('[data-wide-index="3"]').fill('1.5');
  await page.waitForTimeout(100);

  const paths = await page.locator('#wide-rays path').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d') || ''));
  assert.equal(paths.some((path) => /NaN|Infinity/.test(path)), false, 'all rendered paths must be finite');
  const hostile = await page.evaluate(() => {
    const api = window.__WIDE_OPTICS_LAB__;
    const before = JSON.stringify(api.snapshot);
    const angles = [NaN, Infinity, -1, 75.1, '40', null, {}, []].map((value) => {
      try { return api.setAngle(value); } catch { return 'threw'; }
    });
    const indices = [null, [], Array(7).fill(.9), Array(7).fill('1.5'), Array(7).fill(NaN)].map((value) => {
      try { return api.setIndices(value); } catch { return 'threw'; }
    });
    const descriptor = Object.getOwnPropertyDescriptor(window, '__WIDE_OPTICS_LAB__');
    return { before, after: JSON.stringify(api.snapshot), angles, indices, frozen: Object.isFrozen(api), descriptor };
  });
  assert.deepEqual(hostile.angles, Array(8).fill(false));
  assert.deepEqual(hostile.indices, Array(5).fill(false));
  assert.equal(hostile.after, hostile.before);
  assert.equal(hostile.frozen, true);
  assert.equal(hostile.descriptor.writable, false);
  assert.equal(hostile.descriptor.configurable, false);

  return {
    multilayerPhysics: 'pass', refractiveIndexColorDepth: 'pass', dynamicLabelContrast: 'pass',
    fixedEntryPoint: 'pass', fixedInterfaceGeometry: 'pass',
    visiblePathArrows: 'pass', directRayDrag: 'pass', keyboard: 'pass',
    proportionalArrowheads: 'pass', invalidStateRetention: 'pass',
  };
}

async function runTouchInteraction(page) {
  assert.equal(await page.evaluate(() => window.__WIDE_OPTICS_LAB__.setAngle(30)), true);
  const before = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.state.angle);
  const sourceBox = await page.locator('#wide-source-handle').boundingBox();
  assert.ok(sourceBox, 'touch source handle must be visible');
  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...start, radiusX: 10, radiusY: 10, force: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x - 72, y: start.y + 4, radiusX: 10, radiusY: 10, force: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => window.__WIDE_OPTICS_LAB__.state.angle);
  assert.notEqual(after, before, 'touch-dragging the source must change the angle');
  return 'pass';
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce', hasTouch: viewport.name.includes('tablet') });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });

    const response = await page.goto(`${baseUrl}/?qa=${Date.now()}-${viewport.name}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, `${viewport.name}: HTTP status`);
    assert.equal(await page.title(), expectedTitle, `${viewport.name}: page identity`);
    await page.waitForSelector('[data-wide-app-ready="true"]');

    const geometry = await assertLayout(page, viewport);
    const accessibility = await assertAccessibility(page, viewport);
    if (viewport.name === 'laptop-1440x900') report.interaction = await runInteractions(page);
    if (viewport.name === 'tablet-landscape-1024x768') report.interaction.touchRayDrag = await runTouchInteraction(page);
    await page.screenshot({ path: resolve(artifactDir, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${viewport.name}: browser errors ${JSON.stringify(errors)}`);
    report.viewports.push({ name: viewport.name, controlsWidth: geometry.controls.width, stageWidth: geometry.stage.width, scene: geometry.scene, accessibility });
    await context.close();
    console.log(`PASS ${viewport.name}`);
  }
  await writeFile(resolve(artifactDir, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS wide browser QA (${viewports.length} laptop/tablet viewports)`);
} finally {
  await browser.close();
  if (local) local.child.kill();
}
