import { traceLayerStack } from '../src/optics.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_INDICES = Object.freeze([1.7, 1.5, 1.3, 1.6, 1.4, 1.2, 1.0]);
const PRESETS = Object.freeze({
  through: Object.freeze({ indices: DEFAULT_INDICES, angle: 30, side: 1 }),
  'deep-tir': Object.freeze({ indices: DEFAULT_INDICES, angle: 45, side: 1 }),
  'early-tir': Object.freeze({ indices: DEFAULT_INDICES, angle: 65, side: 1 }),
});
const LAYER_COLORS = Object.freeze(['#c8e7e5', '#d9ece8', '#eef2db', '#f5e7bd', '#f6d9bc', '#f3c7bb', '#dfd3ea']);
const byId = (id) => document.getElementById(id);
const dom = Object.freeze({
  angle: byId('wide-angle-range'),
  angleOutput: byId('wide-angle-output'),
  angleChip: byId('wide-angle-chip'),
  inputs: Object.freeze([...document.querySelectorAll('[data-wide-index]')]),
  validation: byId('wide-validation'),
  resultBanner: byId('wide-result-banner'),
  resultTitle: byId('stage-title'),
  resultExplanation: byId('wide-result-explanation'),
  scene: byId('wide-scene'),
  sceneDesc: byId('wide-scene-desc'),
  backgrounds: byId('wide-backgrounds'),
  rays: byId('wide-rays'),
  annotations: byId('wide-annotations'),
  incidentHit: byId('wide-incident-hit'),
  source: byId('wide-source-handle'),
  sourceTouch: byId('wide-source-touch'),
  invariant: byId('wide-invariant'),
  reflectedTotal: byId('wide-reflected-total'),
  exitPower: byId('wide-exit-power'),
  events: byId('wide-events'),
  live: byId('wide-live'),
});

let state = Object.freeze({ indices: DEFAULT_INDICES, angle: 30, side: 1 });
let snapshot = traceLayerStack({ indices: [...state.indices], incidentDeg: state.angle });
let currentGeometry = null;
let dragging = false;
let dragPointerId = null;
let announceTimer = 0;

function fixed(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function svgNode(name, attributes = {}, text = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function pathData(from, to) {
  return `M ${fixed(from.x, 2)} ${fixed(from.y, 2)} L ${fixed(to.x, 2)} ${fixed(to.y, 2)}`;
}

function polarPoint(cx, cy, radius, degrees) {
  const radians = degrees * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx, cy, radius, startDeg, endDeg) {
  const start = polarPoint(cx, cy, radius, startDeg);
  const end = polarPoint(cx, cy, radius, endDeg);
  const delta = endDeg - startDeg;
  return `M ${fixed(start.x, 2)} ${fixed(start.y, 2)} A ${radius} ${radius} 0 0 ${delta >= 0 ? 1 : 0} ${fixed(end.x, 2)} ${fixed(end.y, 2)}`;
}

function geometryFor(trace, side) {
  const sourceUnit = { x: 0, y: 0.16 };
  const impacts = [];
  const samples = [sourceUnit.x];
  let x = sourceUnit.x;
  let y = sourceUnit.y;
  let angle = trace.incidentDeg;

  for (let index = 0; index < trace.events.length; index += 1) {
    const event = trace.events[index];
    if (!event.reached) break;
    const targetY = index + 1;
    x += side * Math.tan(angle * Math.PI / 180) * (targetY - y);
    y = targetY;
    impacts.push({ x, y, event });
    samples.push(x);
    const branchX = x + side * Math.tan(event.incidentDeg * Math.PI / 180) * 0.58;
    samples.push(branchX);
    if (event.totalInternalReflection || event.atCritical) break;
    angle = event.refractedDeg;
  }

  let exitUnit = null;
  if (trace.termination === 'exited-bottom') {
    const targetY = 7;
    x += side * Math.tan(angle * Math.PI / 180) * (targetY - y);
    exitUnit = { x, y: targetY };
    samples.push(x);
  }

  const minX = Math.min(...samples);
  const maxX = Math.max(...samples);
  const span = Math.max(0.1, maxX - minX);
  const layerHeight = Math.max(26, Math.min(76, 550 / 7, 850 / (span + 1.3)));
  const topY = (640 - 7 * layerHeight) / 2;
  const originX = 480 - ((minX + maxX) / 2) * layerHeight;
  const point = (unit) => ({ x: originX + unit.x * layerHeight, y: topY + unit.y * layerHeight });

  return Object.freeze({
    layerHeight,
    topY,
    bottomY: topY + 7 * layerHeight,
    source: point(sourceUnit),
    impacts: Object.freeze(impacts.map((impact) => Object.freeze({ ...point(impact), event: impact.event }))),
    exit: exitUnit ? point(exitUnit) : null,
  });
}

function renderBackgrounds(trace, geometry) {
  dom.backgrounds.replaceChildren();
  dom.annotations.replaceChildren();
  const showLabels = geometry.layerHeight >= 43;

  trace.indices.forEach((n, index) => {
    const y = geometry.topY + index * geometry.layerHeight;
    dom.backgrounds.append(svgNode('rect', {
      class: 'layer-fill', x: 0, y: fixed(y, 2), width: 960,
      height: fixed(geometry.layerHeight, 2), fill: LAYER_COLORS[index],
    }));
    if (showLabels) {
      dom.annotations.append(svgNode('text', {
        class: 'medium-label', x: 16, y: fixed(y + geometry.layerHeight * 0.58, 2),
      }, `介質 ${index + 1}　n = ${fixed(n, 3)}`));
    }
  });

  trace.events.forEach((event, index) => {
    const y = geometry.topY + (index + 1) * geometry.layerHeight;
    dom.backgrounds.append(svgNode('line', {
      class: `interface-line${event.reached ? '' : ' blocked'}`,
      x1: 0, y1: fixed(y, 2), x2: 960, y2: fixed(y, 2),
    }));
    if (showLabels) {
      dom.annotations.append(svgNode('text', {
        class: 'interface-label', x: 879, y: fixed(y - 7, 2),
      }, `界面 ${event.label}`));
    }
  });
}

function renderAngleGuide(geometry, nextState) {
  const impact = geometry.impacts[0];
  if (!impact) return;
  const normalTop = { x: impact.x, y: Math.max(geometry.topY, impact.y - geometry.layerHeight * 0.68) };
  dom.annotations.append(svgNode('line', {
    x1: fixed(impact.x, 2), y1: fixed(impact.y, 2), x2: fixed(normalTop.x, 2), y2: fixed(normalTop.y, 2),
    stroke: '#547075', 'stroke-width': 1.6, 'stroke-dasharray': '6 6',
  }));
  const rayAngle = nextState.side === 1 ? -90 - nextState.angle : -90 + nextState.angle;
  dom.annotations.append(svgNode('path', {
    class: 'angle-arc', d: arcPath(impact.x, impact.y, Math.min(48, geometry.layerHeight * 0.54), -90, rayAngle),
  }));
  const labelAngle = -90 + (rayAngle + 90) / 2;
  const labelPoint = polarPoint(impact.x, impact.y, Math.min(72, geometry.layerHeight * 0.8), labelAngle);
  dom.annotations.append(svgNode('text', {
    class: 'angle-label',
    x: fixed(labelPoint.x + (nextState.side === 1 ? -48 : 8), 2),
    y: fixed(labelPoint.y - 2, 2),
  }, `θ₁ ${fixed(nextState.angle)}°`));
}

function renderRays(trace, geometry, nextState) {
  dom.rays.replaceChildren();
  const points = [geometry.source, ...geometry.impacts.map(({ x, y }) => ({ x, y }))];
  if (geometry.exit) points.push(geometry.exit);

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const incomingPower = index <= geometry.impacts.length
      ? geometry.impacts[index - 1].event.incomingPower
      : trace.exitPower;
    const d = pathData(from, to);
    if (index === 1) {
      dom.rays.append(svgNode('path', { class: 'ray-glow', d }));
      dom.incidentHit.setAttribute('d', d);
    }
    dom.rays.append(svgNode('path', {
      id: index === 1 ? 'wide-incident-ray' : '',
      class: `primary-ray${index === 1 ? ' incident' : ''}`,
      d,
      opacity: fixed(Math.max(.28, Math.sqrt(Math.max(0, incomingPower))), 3),
    }));
  }

  geometry.impacts.forEach((impact) => {
    const { event } = impact;
    const branchDy = geometry.layerHeight * 0.58;
    const branchDx = nextState.side * Math.tan(event.incidentDeg * Math.PI / 180) * branchDy;
    if (event.reflectedPower > 1e-10) {
      dom.rays.append(svgNode('path', {
        class: 'reflection-ray',
        d: pathData(impact, { x: impact.x + branchDx, y: impact.y - branchDy }),
        opacity: fixed(Math.max(.28, Math.sqrt(event.reflectedPower)), 3),
      }));
    }
    if (event.atCritical) {
      dom.rays.append(svgNode('path', {
        class: 'grazing-ray',
        d: pathData(impact, {
          x: Math.max(36, Math.min(924, impact.x + nextState.side * Math.max(76, geometry.layerHeight * 1.25))),
          y: impact.y,
        }),
      }));
    }
    dom.rays.append(svgNode('circle', {
      class: `impact${event.totalInternalReflection ? ' tir' : ''}`,
      cx: fixed(impact.x, 2), cy: fixed(impact.y, 2), r: event.totalInternalReflection ? 7 : 4.5,
    }));
    if (event.totalInternalReflection || event.atCritical) {
      const labelX = Math.max(80, Math.min(760, impact.x + (nextState.side === 1 ? 14 : -170)));
      dom.rays.append(svgNode('text', {
        class: 'ray-label', x: fixed(labelX, 2), y: fixed(impact.y - 12, 2),
      }, event.totalInternalReflection ? `界面 ${event.label}：全反射` : `界面 ${event.label}：臨界角`));
    }
  });

  renderAngleGuide(geometry, nextState);
  dom.source.setAttribute('transform', `translate(${fixed(geometry.source.x, 2)} ${fixed(geometry.source.y, 2)})`);
  const dragX = Math.max(16, Math.min(790, geometry.source.x + (nextState.side === 1 ? -126 : 18)));
  const dragY = Math.max(24, geometry.source.y - 18);
  dom.annotations.append(svgNode('text', { class: 'drag-label', x: fixed(dragX, 2), y: fixed(dragY, 2) }, '拖曳入射光'));
}

function eventState(event) {
  if (!event.reached) return { key: 'blocked', title: `未抵達（在 ${event.blockedBy} 停止）` };
  if (event.totalInternalReflection) return { key: 'tir', title: '全反射' };
  if (event.atCritical) return { key: 'critical', title: '臨界狀態・沿界面' };
  if (event.bending === 'toward-normal') return { key: 'pass', title: '折射・向法線' };
  if (event.bending === 'away-from-normal') return { key: 'pass', title: '折射・離法線' };
  return { key: 'pass', title: '直線通過' };
}

function renderEvents(trace) {
  dom.events.replaceChildren();
  trace.events.forEach((event) => {
    const copy = eventState(event);
    const card = document.createElement('article');
    card.className = 'event-card';
    card.dataset.interface = event.label;
    card.dataset.state = copy.key;
    const heading = document.createElement('div');
    heading.className = 'event-card-heading';
    const name = document.createElement('strong');
    name.textContent = `界面 ${event.label}`;
    const stateLabel = document.createElement('span');
    stateLabel.textContent = copy.title;
    heading.append(name, stateLabel);
    const indices = document.createElement('p');
    indices.textContent = `${fixed(event.n1, 3)} → ${fixed(event.n2, 3)}`;
    const detail = document.createElement('p');
    detail.textContent = event.reached
      ? `θᵢ ${fixed(event.incidentDeg)}°　θₜ ${event.refractedDeg === null ? '—' : `${fixed(event.refractedDeg)}°`}　R ${fixed(event.reflectedPower * 100, 2)}%`
      : '主光線已停止，沒有新的入射事件。';
    card.append(heading, indices, detail);
    dom.events.append(card);
  });
}

function resultCopy(trace) {
  if (trace.termination === 'total-internal-reflection') {
    const event = trace.events.find((entry) => entry.label === trace.terminatedAt);
    return {
      kind: 'tir',
      title: `界面 ${trace.terminatedAt} 發生全反射`,
      explanation: `入射角 ${fixed(event.incidentDeg, 2)}° 大於臨界角 ${fixed(event.criticalDeg, 2)}°，主光線不再抵達下方界面。`,
    };
  }
  if (trace.termination === 'grazing') {
    return {
      kind: 'critical',
      title: `界面 ${trace.terminatedAt} 達到臨界角`,
      explanation: '折射角為 90°，光沿界面前進，因此不會抵達下一個平行界面。',
    };
  }
  return {
    kind: 'pass',
    title: '穿過六個界面',
    explanation: `主光線抵達介質 7，最下方輸出為最初能量的 ${fixed(trace.exitPower * 100, 2)}%。`,
  };
}

function syncPresetState(nextState) {
  document.querySelectorAll('[data-wide-preset]').forEach((button) => {
    const preset = PRESETS[button.dataset.widePreset];
    const active = preset
      && Math.abs(preset.angle - nextState.angle) < 1e-9
      && preset.side === nextState.side
      && preset.indices.every((value, index) => Math.abs(value - nextState.indices[index]) < 1e-9);
    button.setAttribute('aria-pressed', String(Boolean(active)));
  });
}

function render(nextState, trace, { announce = true } = {}) {
  const geometry = geometryFor(trace, nextState.side);
  currentGeometry = geometry;
  renderBackgrounds(trace, geometry);
  renderRays(trace, geometry, nextState);
  renderEvents(trace);

  const angleText = `${fixed(nextState.angle)}°`;
  dom.angle.value = String(nextState.angle);
  dom.angleOutput.value = angleText;
  dom.angleChip.textContent = angleText;
  dom.angle.setAttribute('aria-valuetext', `${fixed(nextState.angle)} 度`);
  for (const slider of [dom.incidentHit, dom.source]) {
    slider.setAttribute('aria-valuenow', fixed(nextState.angle));
    slider.setAttribute('aria-valuetext', `入射角 ${fixed(nextState.angle)} 度`);
  }
  const sceneCtm = dom.scene.getScreenCTM();
  const sceneScale = sceneCtm ? Math.hypot(sceneCtm.a, sceneCtm.b) : (dom.scene.getBoundingClientRect().width / 960 || 1);
  dom.sourceTouch.setAttribute('r', fixed(Math.max(26, 24 / sceneScale), 2));
  dom.incidentHit.style.strokeWidth = `${fixed(Math.max(40, 46 / sceneScale), 2)}px`;
  dom.invariant.textContent = fixed(trace.invariant, 3);
  dom.reflectedTotal.textContent = `${fixed(trace.totalReflectedPower * 100, 2)}%`;
  dom.exitPower.textContent = `${fixed(trace.exitPower * 100, 2)}%`;

  const copy = resultCopy(trace);
  dom.resultBanner.dataset.kind = copy.kind;
  dom.resultTitle.textContent = copy.title;
  dom.resultExplanation.textContent = copy.explanation;
  dom.sceneDesc.textContent = `光以 ${fixed(nextState.angle)} 度由介質 1 向下入射。${copy.title}。${copy.explanation}`;
  syncPresetState(nextState);

  if (announce) {
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => { dom.live.textContent = `${copy.title}。${copy.explanation}`; }, 120);
  }
}

function readIndices() {
  return dom.inputs.map((input, index) => {
    const value = Number(input.value);
    const invalid = input.value.trim() === '' || !input.validity.valid || !Number.isFinite(value) || value < 1 || value > 3;
    input.setAttribute('aria-invalid', String(invalid));
    if (invalid) throw new RangeError(`介質 ${index + 1} 請輸入 1.000 到 3.000`);
    return value;
  });
}

function commit(options = {}) {
  clearTimeout(announceTimer);
  try {
    const indices = Object.freeze(readIndices());
    const angle = Number(dom.angle.value);
    const trace = traceLayerStack({ indices: [...indices], incidentDeg: angle });
    state = Object.freeze({ indices, angle, side: state.side });
    snapshot = trace;
    dom.validation.textContent = '';
    render(state, snapshot, options);
    return true;
  } catch (error) {
    dom.validation.textContent = error instanceof Error ? error.message : '輸入值無效';
    return false;
  }
}

function setPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return false;
  dom.inputs.forEach((input, index) => { input.value = fixed(preset.indices[index], 3); });
  dom.angle.value = String(preset.angle);
  state = Object.freeze({ ...state, side: preset.side });
  return commit();
}

function setAngle(value, options = { announce: false }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 75) return false;
  dom.angle.value = String(value);
  return commit(options);
}

function setIndices(values) {
  if (!Array.isArray(values) || values.length !== 7
    || values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 3)) return false;
  dom.inputs.forEach((input, index) => { input.value = String(values[index]); });
  return commit({ announce: false });
}

function scenePoint(event) {
  const point = dom.scene.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(dom.scene.getScreenCTM().inverse());
}

function updateFromPointer(event) {
  const impact = currentGeometry?.impacts?.[0];
  if (!impact) return;
  const point = scenePoint(event);
  const dx = point.x - impact.x;
  const dy = Math.max(12, impact.y - point.y);
  const angle = Math.min(75, Math.max(0, Math.atan2(Math.abs(dx), dy) * 180 / Math.PI));
  const side = Math.abs(dx) < 1 ? state.side : dx < 0 ? 1 : -1;
  state = Object.freeze({ ...state, side });
  dom.angle.value = fixed(angle);
  commit({ announce: false });
}

function startDrag(event) {
  event.preventDefault();
  dragging = true;
  dragPointerId = event.pointerId;
  dom.scene.setPointerCapture(event.pointerId);
  updateFromPointer(event);
}

function stopDrag(event) {
  if (!dragging || event.pointerId !== dragPointerId) return;
  dragging = false;
  if (dom.scene.hasPointerCapture(event.pointerId)) dom.scene.releasePointerCapture(event.pointerId);
  dragPointerId = null;
  render(state, snapshot);
}

function adjustAngleFromKey(event) {
  if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let angle = state.angle;
  if (event.key === 'Home') angle = 0;
  else if (event.key === 'End') angle = 75;
  else angle += ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1;
  setAngle(Math.max(0, Math.min(75, angle)), { announce: true });
}

dom.angle.addEventListener('input', () => commit({ announce: false }));
dom.angle.addEventListener('change', () => commit());
dom.inputs.forEach((input) => {
  input.addEventListener('input', () => commit({ announce: false }));
  input.addEventListener('change', () => commit());
});
document.querySelectorAll('[data-wide-preset]').forEach((button) => {
  button.addEventListener('click', () => setPreset(button.dataset.widePreset));
});
for (const target of [dom.incidentHit, dom.source]) {
  target.addEventListener('pointerdown', startDrag);
  target.addEventListener('keydown', adjustAngleFromKey);
}
dom.scene.addEventListener('pointermove', (event) => { if (dragging && event.pointerId === dragPointerId) updateFromPointer(event); });
dom.scene.addEventListener('pointerup', stopDrag);
dom.scene.addEventListener('pointercancel', (event) => {
  if (event.pointerId === dragPointerId) {
    dragging = false;
    dragPointerId = null;
  }
});
window.addEventListener('resize', () => render(state, snapshot, { announce: false }));

render(state, snapshot, { announce: false });
document.body.dataset.wideAppReady = 'true';

const api = Object.freeze({
  get state() { return Object.freeze({ angle: state.angle, side: state.side, indices: Object.freeze([...state.indices]) }); },
  get snapshot() { return snapshot; },
  setAngle,
  setIndices,
  setPreset,
});
Object.defineProperty(window, '__WIDE_OPTICS_LAB__', { value: api, writable: false, configurable: false });
