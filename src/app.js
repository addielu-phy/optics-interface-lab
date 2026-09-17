import { solveOptics, traceLayerStack } from './optics.js';

const MEDIA = Object.freeze({
  air: Object.freeze({ name: '空氣', n: 1.0003 }),
  water: Object.freeze({ name: '水', n: 1.333 }),
  ice: Object.freeze({ name: '冰', n: 1.309 }),
  acrylic: Object.freeze({ name: '壓克力', n: 1.49 }),
  glass: Object.freeze({ name: '玻璃', n: 1.52 }),
  fiberCore: Object.freeze({ name: '光纖核心', n: 1.5 }),
  fiberCladding: Object.freeze({ name: '光纖包層', n: 1.46 }),
  diamond: Object.freeze({ name: '鑽石', n: 2.42 }),
});

const PRESETS = Object.freeze({
  pool: Object.freeze({ top: 'water', bottom: 'air', angle: 55, side: -1 }),
  fiber: Object.freeze({ top: 'fiberCore', bottom: 'fiberCladding', angle: 80, side: -1 }),
  straw: Object.freeze({ top: 'air', bottom: 'water', angle: 55, side: -1 }),
  diamond: Object.freeze({ top: 'diamond', bottom: 'air', angle: 30, side: -1 }),
});

const LAYER_DEFAULT_INDICES = Object.freeze([1.7, 1.5, 1.3, 1.6, 1.4, 1.2, 1.0]);
const LAYER_PRESETS = Object.freeze({
  through: Object.freeze({ indices: LAYER_DEFAULT_INDICES, angle: 30 }),
  'deep-tir': Object.freeze({ indices: LAYER_DEFAULT_INDICES, angle: 45 }),
  'early-tir': Object.freeze({ indices: LAYER_DEFAULT_INDICES, angle: 65 }),
});
const LAYER_COLORS = Object.freeze(['#c8e7e5', '#d9ece8', '#eef2db', '#f5e7bd', '#f6d9bc', '#f3c7bb', '#dfd3ea']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const byId = (id) => document.getElementById(id);
const dom = Object.freeze({
  topSelect: byId('incident-medium'),
  bottomSelect: byId('transmitted-medium'),
  topCustomWrap: byId('incident-custom-wrap'),
  bottomCustomWrap: byId('transmitted-custom-wrap'),
  topCustom: byId('incident-custom'),
  bottomCustom: byId('transmitted-custom'),
  swap: byId('swap-media'),
  angle: byId('angle-range'),
  angleOutput: byId('angle-output'),
  validation: byId('validation-status'),
  resultBanner: byId('result-banner'),
  resultTitle: byId('result-title'),
  resultExplanation: byId('result-explanation'),
  resultLive: byId('result-live'),
  scene: byId('optics-scene'),
  sceneDesc: byId('scene-desc'),
  source: byId('source-handle'),
  sourceHit: byId('source-hit'),
  sourceLabel: byId('source-label'),
  upperLabel: byId('upper-medium-label'),
  lowerLabel: byId('lower-medium-label'),
  incidentRay: byId('incident-ray'),
  reflectedRay: byId('reflected-ray'),
  transmittedRay: byId('transmitted-ray'),
  incidentGlow: byId('incident-ray-glow'),
  reflectedGlow: byId('reflected-ray-glow'),
  transmittedGlow: byId('transmitted-ray-glow'),
  incidentArc: byId('incident-arc'),
  refractedArc: byId('refracted-arc'),
  incidentAngleLabel: byId('incident-angle-label'),
  refractedAngleLabel: byId('refracted-angle-label'),
  tirPulse: byId('tir-pulse'),
  metricRefraction: byId('metric-refraction'),
  metricBending: byId('metric-bending'),
  metricCritical: byId('metric-critical'),
  metricCriticalNote: byId('metric-critical-note'),
  metricReflectance: byId('metric-reflectance'),
  reflectionPercent: byId('reflection-percent'),
  transmissionPercent: byId('transmission-percent'),
  reflectionBar: byId('reflection-bar'),
  transmissionBar: byId('transmission-bar'),
  equation: byId('equation-values'),
  layerAngle: byId('layer-angle-range'),
  layerAngleOutput: byId('layer-angle-output'),
  layerInputs: Object.freeze([...document.querySelectorAll('[data-layer-index]')]),
  layerValidation: byId('layer-validation'),
  layerScene: byId('layer-scene'),
  layerSceneDesc: byId('layer-scene-desc'),
  layerBackgrounds: byId('layer-backgrounds'),
  layerRays: byId('layer-rays'),
  layerAnnotations: byId('layer-annotations'),
  layerResultBanner: byId('layer-result-banner'),
  layerResultTitle: byId('layer-result-title'),
  layerResultExplanation: byId('layer-result-explanation'),
  layerInvariant: byId('layer-invariant'),
  layerReflectedTotal: byId('layer-reflected-total'),
  layerExitPower: byId('layer-exit-power'),
  layerEventBody: byId('layer-event-body'),
  layerLive: byId('layer-live'),
});

let state = Object.freeze({ angle: 48, side: -1, n1: MEDIA.glass.n, n2: MEDIA.air.n, topName: '玻璃', bottomName: '空氣' });
let snapshot = solveOptics({ n1: state.n1, n2: state.n2, incidentDeg: state.angle });
let layerState = Object.freeze({ indices: LAYER_DEFAULT_INDICES, angle: 30 });
let layerSnapshot = traceLayerStack({ indices: [...layerState.indices], incidentDeg: layerState.angle });
let dragging = false;
let announceTimer = 0;
let layerAnnounceTimer = 0;

function fixed(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function mediaValue(select, input, label) {
  if (select.value !== 'custom') {
    const medium = MEDIA[select.value];
    if (!medium) throw new RangeError(`${label}不是有效介質`);
    return { n: medium.n, name: medium.name };
  }
  if (!input.validity.valid || input.value.trim() === '') throw new RangeError(`${label}請輸入 1.000 到 3.000`);
  const n = Number(input.value);
  if (!Number.isFinite(n) || n < 1 || n > 3) throw new RangeError(`${label}請輸入 1.000 到 3.000`);
  return { n, name: '自訂介質' };
}

function syncCustomControls() {
  const topIsCustom = dom.topSelect.value === 'custom';
  const bottomIsCustom = dom.bottomSelect.value === 'custom';
  dom.topCustomWrap.hidden = !topIsCustom;
  dom.bottomCustomWrap.hidden = !bottomIsCustom;
  dom.topCustom.disabled = !topIsCustom;
  dom.bottomCustom.disabled = !bottomIsCustom;
}

function pointOnRay(centerX, boundaryY, angleDeg, length, side, below = false) {
  const radians = angleDeg * Math.PI / 180;
  const horizontal = Math.sin(radians) * length;
  const vertical = Math.cos(radians) * length;
  return {
    x: centerX + (below ? -side : side) * horizontal,
    y: boundaryY + (below ? vertical : -vertical),
  };
}

function polarPoint(cx, cy, radius, degrees) {
  const radians = degrees * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx, cy, radius, startDeg, endDeg) {
  const start = polarPoint(cx, cy, radius, startDeg);
  const end = polarPoint(cx, cy, radius, endDeg);
  const delta = endDeg - startDeg;
  const sweep = delta >= 0 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${Math.abs(delta) > 180 ? 1 : 0} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function setPath(element, from, to) {
  element.setAttribute('d', `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`);
}

function statusCopy(model) {
  if (model.totalInternalReflection) {
    return {
      kind: 'tir', title: '全反射',
      explanation: `入射角 ${fixed(model.incidentDeg, 2)}° 大於臨界角 ${fixed(model.criticalDeg, 2)}°，沒有傳播到下方介質的折射光。`,
    };
  }
  if (model.atCritical) {
    return { kind: 'critical', title: '臨界狀態', explanation: '折射角正好是 90°，折射光沿著界面前進。' };
  }
  if (model.bending === 'toward-normal') return { kind: 'refraction', title: '向法線偏折', explanation: '光進入折射率較大的介質，速率變慢，折射角小於入射角。' };
  if (model.bending === 'away-from-normal') return { kind: 'refraction', title: '離法線偏折', explanation: '光進入折射率較小的介質，速率變快，折射角大於入射角。' };
  return { kind: 'refraction', title: '沿原方向前進', explanation: '正入射或兩側折射率相同時，光線方向不改變。' };
}

function render(nextState, model, { announce = true } = {}) {
  const cx = 450;
  const cy = 280;
  const incidentLength = 200;
  const outgoingLength = 235;
  const source = pointOnRay(cx, cy, nextState.angle, incidentLength, nextState.side, false);
  const reflected = pointOnRay(cx, cy, nextState.angle, outgoingLength, -nextState.side, false);
  const impact = { x: cx, y: cy };
  setPath(dom.incidentRay, source, impact);
  setPath(dom.incidentGlow, source, impact);
  setPath(dom.reflectedRay, impact, reflected);
  setPath(dom.reflectedGlow, impact, reflected);

  const sceneScale = dom.scene.getBoundingClientRect().width / 900 || 1;
  dom.sourceHit.setAttribute('r', fixed(Math.max(24, 22 / sceneScale), 2));
  dom.source.setAttribute('transform', `translate(${fixed(source.x, 2)} ${fixed(source.y, 2)})`);
  dom.source.setAttribute('aria-valuenow', fixed(nextState.angle));
  dom.source.setAttribute('aria-valuetext', `入射角 ${fixed(nextState.angle)} 度`);
  dom.sourceLabel.setAttribute('x', fixed(source.x + (nextState.side < 0 ? -68 : 32), 2));
  dom.sourceLabel.setAttribute('y', fixed(Math.max(32, source.y - 26), 2));

  const incidentEndAngle = nextState.side < 0 ? -90 - nextState.angle : -90 + nextState.angle;
  dom.incidentArc.setAttribute('d', arcPath(cx, cy, 72, -90, incidentEndAngle));
  const incidentLabelPoint = polarPoint(cx, cy, 104, -90 + (incidentEndAngle + 90) / 2);
  dom.incidentAngleLabel.setAttribute('x', fixed(incidentLabelPoint.x + (nextState.side < 0 ? -45 : 8), 2));
  dom.incidentAngleLabel.setAttribute('y', fixed(incidentLabelPoint.y, 2));
  dom.incidentAngleLabel.textContent = `θ₁ ${fixed(nextState.angle)}°`;

  const showReflection = model.reflectance > 1e-10;
  dom.reflectedRay.toggleAttribute('hidden', !showReflection);
  dom.reflectedGlow.toggleAttribute('hidden', !showReflection);
  if (showReflection) {
    const reflectOpacity = Math.max(.24, model.reflectance);
    dom.reflectedRay.style.opacity = String(reflectOpacity);
    dom.reflectedGlow.style.opacity = String(reflectOpacity * .22);
  }

  if (model.totalInternalReflection) {
    dom.transmittedRay.toggleAttribute('hidden', true);
    dom.transmittedGlow.toggleAttribute('hidden', true);
    dom.refractedArc.toggleAttribute('hidden', true);
    dom.refractedAngleLabel.toggleAttribute('hidden', true);
    dom.tirPulse.toggleAttribute('hidden', false);
  } else {
    const transmitted = pointOnRay(cx, cy, model.refractedDeg, outgoingLength, nextState.side, true);
    setPath(dom.transmittedRay, impact, transmitted);
    setPath(dom.transmittedGlow, impact, transmitted);
    dom.transmittedRay.toggleAttribute('hidden', false);
    dom.transmittedGlow.toggleAttribute('hidden', false);
    dom.refractedArc.toggleAttribute('hidden', false);
    dom.refractedAngleLabel.toggleAttribute('hidden', false);
    dom.tirPulse.toggleAttribute('hidden', true);
    const refractedEndAngle = nextState.side < 0 ? 90 - model.refractedDeg : 90 + model.refractedDeg;
    dom.refractedArc.setAttribute('d', arcPath(cx, cy, 68, 90, refractedEndAngle));
    const refractedLabelPoint = polarPoint(cx, cy, 108, 90 + (refractedEndAngle - 90) / 2);
    dom.refractedAngleLabel.setAttribute('x', fixed(refractedLabelPoint.x + (nextState.side < 0 ? 10 : -62), 2));
    dom.refractedAngleLabel.setAttribute('y', fixed(refractedLabelPoint.y + 14, 2));
    dom.refractedAngleLabel.textContent = `θ₂ ${fixed(model.refractedDeg)}°`;
    const transmitOpacity = Math.max(.24, model.transmittance);
    dom.transmittedRay.style.opacity = String(transmitOpacity);
    dom.transmittedGlow.style.opacity = String(transmitOpacity * .22);
  }

  dom.upperLabel.textContent = `入射介質：${nextState.topName}  n₁ = ${fixed(nextState.n1, nextState.n1 < 1.01 ? 4 : 3)}`;
  dom.lowerLabel.textContent = `穿透介質：${nextState.bottomName}  n₂ = ${fixed(nextState.n2, nextState.n2 < 1.01 ? 4 : 3)}`;
  dom.angle.value = String(nextState.angle);
  dom.angleOutput.value = `${fixed(nextState.angle)}°`;
  dom.angle.setAttribute('aria-valuetext', `${fixed(nextState.angle)} 度`);

  const copy = statusCopy(model);
  dom.resultBanner.dataset.kind = copy.kind;
  dom.resultTitle.textContent = copy.title;
  dom.resultExplanation.textContent = copy.explanation;
  dom.metricRefraction.textContent = model.refractedDeg === null ? '—' : `${fixed(model.refractedDeg)}°`;
  dom.metricBending.textContent = model.refractedDeg === null ? '無折射光' : model.bending === 'toward-normal' ? '向法線偏折' : model.bending === 'away-from-normal' ? '離法線偏折' : '不偏折';
  dom.metricCritical.textContent = model.criticalDeg === null ? '不存在' : `${fixed(model.criticalDeg, 2)}°`;
  dom.metricCriticalNote.textContent = model.criticalDeg === null ? 'n₁ ≤ n₂ 時沒有臨界角' : '僅限 n₁ > n₂';
  const rPercent = model.reflectance * 100;
  const tPercent = model.transmittance * 100;
  dom.metricReflectance.textContent = `${fixed(rPercent)}%`;
  dom.reflectionPercent.textContent = `${fixed(rPercent)}%`;
  dom.transmissionPercent.textContent = `${fixed(tPercent)}%`;
  dom.reflectionBar.style.width = `${rPercent}%`;
  dom.transmissionBar.style.width = `${tPercent}%`;
  const left = nextState.n1 * Math.sin(nextState.angle * Math.PI / 180);
  if (model.totalInternalReflection) {
    const requiredSin = left / nextState.n2;
    dom.equation.textContent = `${fixed(nextState.n1,3)} × sin ${fixed(nextState.angle)}° = ${fixed(left,3)}；所需 sin θ₂ = ${fixed(requiredSin,3)} > 1，無實數折射角`;
  } else {
    const right = nextState.n2 * Math.sin(model.refractedDeg * Math.PI / 180);
    dom.equation.textContent = `${fixed(nextState.n1,3)} × sin ${fixed(nextState.angle)}° = ${fixed(left,3)} ≈ ${fixed(nextState.n2,3)} × sin ${fixed(model.refractedDeg)}° = ${fixed(right,3)}`;
  }
  dom.sceneDesc.textContent = `${nextState.topName}中的光以${fixed(nextState.angle)}度射向${nextState.bottomName}，${copy.title}。`;
  if (announce) {
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => { dom.resultLive.textContent = `${copy.title}。${copy.explanation}`; }, 120);
  }
}

function commitFromControls(options = {}) {
  clearTimeout(announceTimer);
  try {
    syncCustomControls();
    const top = mediaValue(dom.topSelect, dom.topCustom, '入射介質');
    const bottom = mediaValue(dom.bottomSelect, dom.bottomCustom, '穿透介質');
    const angle = Number(dom.angle.value);
    const candidate = Object.freeze({ angle, side: state.side, n1: top.n, n2: bottom.n, topName: top.name, bottomName: bottom.name });
    const model = solveOptics({ n1: candidate.n1, n2: candidate.n2, incidentDeg: candidate.angle });
    state = candidate;
    snapshot = model;
    dom.validation.textContent = '';
    dom.topCustom.setAttribute('aria-invalid', 'false');
    dom.bottomCustom.setAttribute('aria-invalid', 'false');
    render(state, snapshot, options);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '輸入值無效';
    dom.validation.textContent = message;
    if (dom.topSelect.value === 'custom') dom.topCustom.setAttribute('aria-invalid', String(!dom.topCustom.validity.valid || dom.topCustom.value.trim() === ''));
    if (dom.bottomSelect.value === 'custom') dom.bottomCustom.setAttribute('aria-invalid', String(!dom.bottomCustom.validity.valid || dom.bottomCustom.value.trim() === ''));
    return false;
  }
}

function setPreset(preset) {
  const next = PRESETS[preset];
  if (!next) return false;
  dom.topSelect.value = next.top;
  dom.bottomSelect.value = next.bottom;
  dom.angle.value = String(next.angle);
  state = Object.freeze({ ...state, side: next.side });
  return commitFromControls();
}

function swapMedia() {
  const topValue = dom.topSelect.value;
  const topCustom = dom.topCustom.value;
  dom.topSelect.value = dom.bottomSelect.value;
  dom.topCustom.value = dom.bottomCustom.value;
  dom.bottomSelect.value = topValue;
  dom.bottomCustom.value = topCustom;
  commitFromControls();
}

function svgNode(name, attributes = {}, text = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function layerGeometry(trace) {
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
    bottomY: topY + 7 * layerHeight,
    source: point({ x: 0, y: 0.18 }),
    impacts: Object.freeze(unitImpacts.map((impact) => Object.freeze({ ...point(impact), event: impact.event }))),
    exit: unitExit ? point(unitExit) : null,
  });
}

function renderLayerBackgrounds(trace, geometry) {
  dom.layerBackgrounds.replaceChildren();
  dom.layerAnnotations.replaceChildren();
  const showMediumLabels = geometry.layerHeight >= 46;

  trace.indices.forEach((indexValue, index) => {
    const y = geometry.topY + index * geometry.layerHeight;
    dom.layerBackgrounds.append(svgNode('rect', {
      class: 'layer-medium-fill', x: 0, y: fixed(y, 2), width: 900,
      height: fixed(geometry.layerHeight, 2), fill: LAYER_COLORS[index],
    }));
    if (showMediumLabels) {
      dom.layerAnnotations.append(svgNode('text', {
        class: 'layer-medium-text', x: 20, y: fixed(y + geometry.layerHeight * 0.58, 2),
      }, `介質 ${index + 1}　n = ${fixed(indexValue, 3)}`));
    }
  });

  trace.events.forEach((event, index) => {
    const y = geometry.topY + (index + 1) * geometry.layerHeight;
    dom.layerBackgrounds.append(svgNode('line', {
      class: `layer-interface-line${event.reached ? '' : ' blocked'}`,
      x1: 0, y1: fixed(y, 2), x2: 900, y2: fixed(y, 2),
    }));
    if (showMediumLabels) {
      dom.layerAnnotations.append(svgNode('text', {
        class: 'layer-interface-text', x: 820, y: fixed(y - 8, 2),
      }, `界面 ${event.label}`));
    }
  });
}

function renderLayerRays(trace, geometry) {
  dom.layerRays.replaceChildren();
  const pathPoints = [geometry.source, ...geometry.impacts.map(({ x, y }) => ({ x, y }))];
  if (geometry.exit) pathPoints.push(geometry.exit);

  for (let index = 1; index < pathPoints.length; index += 1) {
    const from = pathPoints[index - 1];
    const to = pathPoints[index];
    const incoming = index <= geometry.impacts.length
      ? geometry.impacts[index - 1].event.incomingPower
      : trace.exitPower;
    dom.layerRays.append(svgNode('path', {
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
      dom.layerRays.append(svgNode('path', {
        class: 'layer-reflection-ray',
        d: `M ${fixed(impact.x, 2)} ${fixed(impact.y, 2)} L ${fixed(impact.x + branchDx, 2)} ${fixed(impact.y - branchDy, 2)}`,
        opacity: fixed(Math.max(0.24, Math.sqrt(event.reflectedPower)), 3),
      }));
    }
    if (event.atCritical) {
      dom.layerRays.append(svgNode('path', {
        class: 'layer-grazing-ray',
        d: `M ${fixed(impact.x, 2)} ${fixed(impact.y, 2)} L ${fixed(Math.min(870, impact.x + Math.max(70, geometry.layerHeight)), 2)} ${fixed(impact.y, 2)}`,
      }));
    }
    dom.layerRays.append(svgNode('circle', {
      class: `layer-impact${event.totalInternalReflection ? ' tir' : ''}`,
      cx: fixed(impact.x, 2), cy: fixed(impact.y, 2), r: event.totalInternalReflection ? 8 : 5,
    }));
    if (event.totalInternalReflection || event.atCritical) {
      dom.layerRays.append(svgNode('text', {
        class: 'layer-ray-label', x: fixed(Math.min(760, impact.x + 15), 2), y: fixed(impact.y - 13, 2),
      }, event.totalInternalReflection ? `界面 ${event.label}：全反射` : `界面 ${event.label}：臨界角`));
    }
  });
}

function layerEventState(event) {
  if (!event.reached) return { key: 'blocked', text: `未抵達（在 ${event.blockedBy} 停止）` };
  if (event.totalInternalReflection) return { key: 'tir', text: '全反射' };
  if (event.atCritical) return { key: 'critical', text: '臨界狀態：沿界面' };
  if (event.bending === 'toward-normal') return { key: 'pass', text: '折射：向法線' };
  if (event.bending === 'away-from-normal') return { key: 'pass', text: '折射：離法線' };
  return { key: 'pass', text: '直線通過' };
}

function renderLayerTable(trace) {
  dom.layerEventBody.replaceChildren();
  trace.events.forEach((event) => {
    const stateCopy = layerEventState(event);
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
    dom.layerEventBody.append(row);
  });
}

function renderLayerLab(nextState, trace, { announce = true } = {}) {
  const geometry = layerGeometry(trace);
  renderLayerBackgrounds(trace, geometry);
  renderLayerRays(trace, geometry);
  renderLayerTable(trace);

  dom.layerAngle.value = String(nextState.angle);
  dom.layerAngleOutput.value = `${fixed(nextState.angle)}°`;
  dom.layerAngle.setAttribute('aria-valuetext', `${fixed(nextState.angle)} 度`);
  dom.layerInvariant.textContent = fixed(trace.invariant, 3);
  dom.layerReflectedTotal.textContent = `${fixed(trace.totalReflectedPower * 100, 2)}%`;
  dom.layerExitPower.textContent = `${fixed(trace.exitPower * 100, 2)}%`;

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
  dom.layerResultBanner.dataset.kind = kind;
  dom.layerResultTitle.textContent = title;
  dom.layerResultExplanation.textContent = explanation;
  dom.layerSceneDesc.textContent = `光以 ${fixed(nextState.angle)} 度由介質 1 向下入射。${title}。${explanation}`;

  if (announce) {
    clearTimeout(layerAnnounceTimer);
    layerAnnounceTimer = window.setTimeout(() => { dom.layerLive.textContent = `${title}。${explanation}`; }, 120);
  }
}

function readLayerIndices() {
  return dom.layerInputs.map((input, index) => {
    const value = Number(input.value);
    const invalid = input.value.trim() === '' || !input.validity.valid || !Number.isFinite(value) || value < 1 || value > 3;
    input.setAttribute('aria-invalid', String(invalid));
    if (invalid) throw new RangeError(`介質 ${index + 1} 請輸入 1.000 到 3.000`);
    return value;
  });
}

function commitLayerControls(options = {}) {
  clearTimeout(layerAnnounceTimer);
  try {
    const indices = Object.freeze(readLayerIndices());
    const angle = Number(dom.layerAngle.value);
    const trace = traceLayerStack({ indices: [...indices], incidentDeg: angle });
    layerState = Object.freeze({ indices, angle });
    layerSnapshot = trace;
    dom.layerValidation.textContent = '';
    renderLayerLab(layerState, layerSnapshot, options);
    return true;
  } catch (error) {
    dom.layerValidation.textContent = error instanceof Error ? error.message : '六界面輸入值無效';
    return false;
  }
}

function setLayerPreset(name) {
  const preset = LAYER_PRESETS[name];
  if (!preset) return false;
  dom.layerInputs.forEach((input, index) => { input.value = fixed(preset.indices[index], 3); });
  dom.layerAngle.value = String(preset.angle);
  return commitLayerControls();
}

function setLayerIndices(values) {
  if (!Array.isArray(values) || values.length !== 7
    || values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 3)) return false;
  dom.layerInputs.forEach((input, index) => { input.value = String(values[index]); });
  return commitLayerControls({ announce: false });
}

function setLayerAngle(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 75) return false;
  dom.layerAngle.value = String(value);
  return commitLayerControls({ announce: false });
}

function scenePoint(event) {
  const point = dom.scene.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(dom.scene.getScreenCTM().inverse());
}

function updateFromPointer(event) {
  const point = scenePoint(event);
  const side = point.x < 450 ? -1 : 1;
  const dy = Math.max(10, 280 - Math.min(250, Math.max(38, point.y)));
  const angle = Math.min(89.5, Math.max(0, Math.atan2(Math.abs(point.x - 450), dy) * 180 / Math.PI));
  state = Object.freeze({ ...state, side });
  dom.angle.value = fixed(angle);
  commitFromControls({ announce: false });
}

dom.angle.addEventListener('input', () => commitFromControls({ announce: false }));
dom.angle.addEventListener('change', () => commitFromControls());
for (const control of [dom.topSelect, dom.bottomSelect, dom.topCustom, dom.bottomCustom]) {
  control.addEventListener('input', () => commitFromControls());
  control.addEventListener('change', () => commitFromControls());
}
dom.swap.addEventListener('click', swapMedia);
document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.preset)));

dom.source.addEventListener('pointerdown', (event) => {
  dragging = true;
  dom.source.setPointerCapture(event.pointerId);
  updateFromPointer(event);
});
dom.source.addEventListener('pointermove', (event) => { if (dragging) updateFromPointer(event); });
dom.source.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  dom.source.releasePointerCapture(event.pointerId);
  commitFromControls();
});
dom.source.addEventListener('pointercancel', () => { dragging = false; });
dom.source.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let angle = Number(dom.angle.value);
  if (event.key === 'Home') angle = 0;
  else if (event.key === 'End') angle = 89.5;
  else angle += ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1;
  dom.angle.value = String(Math.max(0, Math.min(89.5, angle)));
  commitFromControls();
});
window.addEventListener('resize', () => {
  render(state, snapshot, { announce: false });
  renderLayerLab(layerState, layerSnapshot, { announce: false });
});

dom.layerAngle.addEventListener('input', () => commitLayerControls({ announce: false }));
dom.layerAngle.addEventListener('change', () => commitLayerControls());
dom.layerInputs.forEach((input) => {
  input.addEventListener('input', () => commitLayerControls());
  input.addEventListener('change', () => commitLayerControls());
});
document.querySelectorAll('[data-layer-preset]').forEach((button) => {
  button.addEventListener('click', () => setLayerPreset(button.dataset.layerPreset));
});

syncCustomControls();
render(state, snapshot, { announce: false });
renderLayerLab(layerState, layerSnapshot, { announce: false });
document.body.dataset.appReady = 'true';

const api = Object.freeze({
  get state() { return Object.freeze({ ...state }); },
  get snapshot() { return Object.freeze({ ...snapshot }); },
  get layerState() { return Object.freeze({ angle: layerState.angle, indices: Object.freeze([...layerState.indices]) }); },
  get layerSnapshot() { return layerSnapshot; },
  setAngle(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 89.5) return false;
    dom.angle.value = String(value);
    return commitFromControls({ announce: false });
  },
  setPreset,
  setLayerAngle,
  setLayerIndices,
  setLayerPreset,
});
Object.defineProperty(window, '__OPTICS_LAB__', { value: api, writable: false, configurable: false });
