import { traceLayerStack } from './optics.js';

const DEFAULT_INDICES = Object.freeze([1.7, 1.5, 1.3, 1.6, 1.4, 1.2, 1.0]);
const PRESETS = Object.freeze({
  through: Object.freeze({ indices: DEFAULT_INDICES, angle: 30 }),
  'deep-tir': Object.freeze({ indices: DEFAULT_INDICES, angle: 45 }),
  'early-tir': Object.freeze({ indices: DEFAULT_INDICES, angle: 65 }),
});
const COLORS = Object.freeze(['#c8e7e5', '#d9ece8', '#eef2db', '#f5e7bd', '#f6d9bc', '#f3c7bb', '#dfd3ea']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const byId = (id) => document.getElementById(id);
const dom = Object.freeze({
  angle: byId('layer-angle-range'),
  angleOutput: byId('layer-angle-output'),
  inputs: Object.freeze([...document.querySelectorAll('[data-layer-index]')]),
  validation: byId('layer-validation'),
  sceneDesc: byId('layer-scene-desc'),
  backgrounds: byId('layer-backgrounds'),
  rays: byId('layer-rays'),
  annotations: byId('layer-annotations'),
  resultBanner: byId('layer-result-banner'),
  resultTitle: byId('layer-result-title'),
  resultExplanation: byId('layer-result-explanation'),
  invariant: byId('layer-invariant'),
  reflectedTotal: byId('layer-reflected-total'),
  exitPower: byId('layer-exit-power'),
  eventBody: byId('layer-event-body'),
  live: byId('layer-live'),
});

let state = Object.freeze({ indices: DEFAULT_INDICES, angle: 30 });
let snapshot = traceLayerStack({ indices: [...state.indices], incidentDeg: state.angle });
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

function geometryFor(trace) {
  const unitImpacts = [];
  const samples = [0];
  let x = 0;
  let y = 0.18;
  let angle = trace.incidentDeg;

  for (let index = 0; index < trace.events.length; index += 1) {
    const event = trace.events[index];
    if (!event.reached) break;
    const targetY = index + 1;
    x += Math.tan(angle * Math.PI / 180) * (targetY - y);
    y = targetY;
    unitImpacts.push({ x, y, event });
    samples.push(x, x + Math.tan(event.incidentDeg * Math.PI / 180) * 0.62);
    if (event.totalInternalReflection || event.atCritical) break;
    angle = event.refractedDeg;
  }

  let unitExit = null;
  if (trace.termination === 'exited-bottom') {
    const targetY = 7;
    x += Math.tan(angle * Math.PI / 180) * (targetY - y);
    unitExit = { x, y: targetY };
    samples.push(x);
  }

  const minX = Math.min(...samples);
  const maxX = Math.max(...samples);
  const span = Math.max(0.1, maxX - minX);
  const layerHeight = Math.max(22, Math.min(82, 700 / (span + 1.7), 620 / 7));
  const topY = (700 - 7 * layerHeight) / 2;
  const originX = 450 - ((minX + maxX) / 2) * layerHeight;
  const point = (unitPoint) => ({ x: originX + unitPoint.x * layerHeight, y: topY + unitPoint.y * layerHeight });

  return Object.freeze({
    layerHeight,
    topY,
    source: point({ x: 0, y: 0.18 }),
    impacts: Object.freeze(unitImpacts.map((impact) => Object.freeze({ ...point(impact), event: impact.event }))),
    exit: unitExit ? point(unitExit) : null,
  });
}

function renderBackgrounds(trace, geometry) {
  dom.backgrounds.replaceChildren();
  dom.annotations.replaceChildren();
  const showLabels = geometry.layerHeight >= 46;

  trace.indices.forEach((indexValue, index) => {
    const y = geometry.topY + index * geometry.layerHeight;
    dom.backgrounds.append(svgNode('rect', {
      class: 'layer-medium-fill', x: 0, y: fixed(y, 2), width: 900,
      height: fixed(geometry.layerHeight, 2), fill: COLORS[index],
    }));
    if (showLabels) {
      dom.annotations.append(svgNode('text', {
        class: 'layer-medium-text', x: 20, y: fixed(y + geometry.layerHeight * 0.58, 2),
      }, `介質 ${index + 1}　n = ${fixed(indexValue, 3)}`));
    }
  });

  trace.events.forEach((event, index) => {
    const y = geometry.topY + (index + 1) * geometry.layerHeight;
    dom.backgrounds.append(svgNode('line', {
      class: `layer-interface-line${event.reached ? '' : ' blocked'}`,
      x1: 0, y1: fixed(y, 2), x2: 900, y2: fixed(y, 2),
    }));
    if (showLabels) {
      dom.annotations.append(svgNode('text', {
        class: 'layer-interface-text', x: 820, y: fixed(y - 8, 2),
      }, `界面 ${event.label}`));
    }
  });
}

function renderRays(trace, geometry) {
  dom.rays.replaceChildren();
  const points = [geometry.source, ...geometry.impacts.map(({ x, y }) => ({ x, y }))];
  if (geometry.exit) points.push(geometry.exit);

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const incoming = index <= geometry.impacts.length
      ? geometry.impacts[index - 1].event.incomingPower
      : trace.exitPower;
    dom.rays.append(svgNode('path', {
      class: `layer-primary-ray${index === 1 ? ' source-segment' : ''}`,
      d: `M ${fixed(from.x, 2)} ${fixed(from.y, 2)} L ${fixed(to.x, 2)} ${fixed(to.y, 2)}`,
      opacity: fixed(Math.max(0.24, Math.sqrt(Math.max(0, incoming))), 3),
    }));
  }

  geometry.impacts.forEach((impact) => {
    const { event } = impact;
    const branchDy = geometry.layerHeight * 0.62;
    const branchDx = Math.tan(event.incidentDeg * Math.PI / 180) * branchDy;
    if (event.reflectedPower > 1e-10) {
      dom.rays.append(svgNode('path', {
        class: 'layer-reflection-ray',
        d: `M ${fixed(impact.x, 2)} ${fixed(impact.y, 2)} L ${fixed(impact.x + branchDx, 2)} ${fixed(impact.y - branchDy, 2)}`,
        opacity: fixed(Math.max(0.24, Math.sqrt(event.reflectedPower)), 3),
      }));
    }
    if (event.atCritical) {
      dom.rays.append(svgNode('path', {
        class: 'layer-grazing-ray',
        d: `M ${fixed(impact.x, 2)} ${fixed(impact.y, 2)} L ${fixed(Math.min(870, impact.x + Math.max(70, geometry.layerHeight)), 2)} ${fixed(impact.y, 2)}`,
      }));
    }
    dom.rays.append(svgNode('circle', {
      class: `layer-impact${event.totalInternalReflection ? ' tir' : ''}`,
      cx: fixed(impact.x, 2), cy: fixed(impact.y, 2), r: event.totalInternalReflection ? 8 : 5,
    }));
    if (event.totalInternalReflection || event.atCritical) {
      dom.rays.append(svgNode('text', {
        class: 'layer-ray-label', x: fixed(Math.min(760, impact.x + 15), 2), y: fixed(impact.y - 13, 2),
      }, event.totalInternalReflection ? `界面 ${event.label}：全反射` : `界面 ${event.label}：臨界角`));
    }
  });
}

function eventState(event) {
  if (!event.reached) return { key: 'blocked', text: `未抵達（在 ${event.blockedBy} 停止）` };
  if (event.totalInternalReflection) return { key: 'tir', text: '全反射' };
  if (event.atCritical) return { key: 'critical', text: '臨界狀態：沿界面' };
  if (event.bending === 'toward-normal') return { key: 'pass', text: '折射：向法線' };
  if (event.bending === 'away-from-normal') return { key: 'pass', text: '折射：離法線' };
  return { key: 'pass', text: '直線通過' };
}

function renderTable(trace) {
  dom.eventBody.replaceChildren();
  trace.events.forEach((event) => {
    const stateCopy = eventState(event);
    const row = document.createElement('tr');
    row.dataset.interface = event.label;
    row.dataset.state = stateCopy.key;
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = event.label;
    const cells = [
      `${fixed(event.n1, 3)} → ${fixed(event.n2, 3)}`,
      event.reached ? `θᵢ ${fixed(event.incidentDeg)}° → ${event.refractedDeg === null ? '—' : `θₜ ${fixed(event.refractedDeg)}°`}` : '—',
      stateCopy.text,
      event.reached ? `反射 ${fixed(event.reflectedPower * 100, 2)}% ／ 向下 ${fixed(event.transmittedPower * 100, 2)}%` : '—',
    ].map((text) => {
      const cell = document.createElement('td');
      cell.textContent = text;
      return cell;
    });
    row.append(heading, ...cells);
    dom.eventBody.append(row);
  });
}

function render(nextState, trace, { announce = true } = {}) {
  const geometry = geometryFor(trace);
  renderBackgrounds(trace, geometry);
  renderRays(trace, geometry);
  renderTable(trace);

  dom.angle.value = String(nextState.angle);
  dom.angleOutput.value = `${fixed(nextState.angle)}°`;
  dom.angle.setAttribute('aria-valuetext', `${fixed(nextState.angle)} 度`);
  dom.invariant.textContent = fixed(trace.invariant, 3);
  dom.reflectedTotal.textContent = `${fixed(trace.totalReflectedPower * 100, 2)}%`;
  dom.exitPower.textContent = `${fixed(trace.exitPower * 100, 2)}%`;

  let kind = 'pass';
  let title = '穿過六個界面';
  let explanation = `主光線抵達介質 7，最下方輸出為最初能量的 ${fixed(trace.exitPower * 100, 2)}%。`;
  if (trace.termination === 'total-internal-reflection') {
    kind = 'tir';
    title = `界面 ${trace.terminatedAt} 發生全反射`;
    const event = trace.events.find((entry) => entry.label === trace.terminatedAt);
    explanation = `入射角 ${fixed(event.incidentDeg, 2)}° 大於臨界角 ${fixed(event.criticalDeg, 2)}°，主光線不再抵達下方界面。`;
  } else if (trace.termination === 'grazing') {
    kind = 'critical';
    title = `界面 ${trace.terminatedAt} 達到臨界角`;
    explanation = '折射角為 90°，光沿界面前進，因此不會抵達下一個平行界面。';
  }
  dom.resultBanner.dataset.kind = kind;
  dom.resultTitle.textContent = title;
  dom.resultExplanation.textContent = explanation;
  dom.sceneDesc.textContent = `光以 ${fixed(nextState.angle)} 度由介質 1 向下入射。${title}。${explanation}`;

  if (announce) {
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => { dom.live.textContent = `${title}。${explanation}`; }, 120);
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
    state = Object.freeze({ indices, angle });
    snapshot = trace;
    dom.validation.textContent = '';
    render(state, snapshot, options);
    return true;
  } catch (error) {
    dom.validation.textContent = error instanceof Error ? error.message : '六界面輸入值無效';
    return false;
  }
}

function setPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return false;
  dom.inputs.forEach((input, index) => { input.value = fixed(preset.indices[index], 3); });
  dom.angle.value = String(preset.angle);
  return commit();
}

function setIndices(values) {
  if (!Array.isArray(values) || values.length !== 7
    || values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 3)) return false;
  dom.inputs.forEach((input, index) => { input.value = String(values[index]); });
  return commit({ announce: false });
}

function setAngle(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 75) return false;
  dom.angle.value = String(value);
  return commit({ announce: false });
}

dom.angle.addEventListener('input', () => commit({ announce: false }));
dom.angle.addEventListener('change', () => commit());
dom.inputs.forEach((input) => {
  input.addEventListener('input', () => commit());
  input.addEventListener('change', () => commit());
});
document.querySelectorAll('[data-layer-preset]').forEach((button) => {
  button.addEventListener('click', () => setPreset(button.dataset.layerPreset));
});
window.addEventListener('resize', () => render(state, snapshot, { announce: false }));

render(state, snapshot, { announce: false });
document.body.dataset.layerPageReady = 'true';

const api = Object.freeze({
  get state() { return Object.freeze({ angle: state.angle, indices: Object.freeze([...state.indices]) }); },
  get snapshot() { return snapshot; },
  setAngle,
  setIndices,
  setPreset,
});
Object.defineProperty(window, '__SIX_INTERFACE_LAB__', { value: api, writable: false, configurable: false });
