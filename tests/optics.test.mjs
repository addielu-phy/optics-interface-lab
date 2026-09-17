import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyInterfaces, solveOptics, traceLayerStack } from '../src/optics.js';

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test('air to glass bends toward the normal by Snell law', () => {
  const result = solveOptics({ n1: 1, n2: 1.5, incidentDeg: 30 });

  closeTo(result.refractedDeg, 19.47122063449069);
  assert.equal(result.totalInternalReflection, false);
  assert.equal(result.bending, 'toward-normal');
  assert.equal(result.reflectedDeg, 30);
});

test('glass to air reports its critical angle and total internal reflection', () => {
  const below = solveOptics({ n1: 1.5, n2: 1, incidentDeg: 40 });
  const above = solveOptics({ n1: 1.5, n2: 1, incidentDeg: 50 });

  closeTo(below.criticalDeg, 41.810314895778596);
  assert.equal(below.totalInternalReflection, false);
  assert.ok(below.reflectance > 0 && below.reflectance < 1);
  assert.equal(above.totalInternalReflection, true);
  assert.equal(above.refractedDeg, null);
  assert.equal(above.reflectance, 1);
  assert.equal(above.transmittance, 0);
});

test('six-layer question includes path constraints from earlier parallel interfaces', () => {
  const interfaces = classifyInterfaces([1.7, 1.5, 1.3, 1.6, 1.4, 1.0]);

  assert.deepEqual(
    interfaces.filter((entry) => entry.canTir).map((entry) => entry.label),
    ['A', 'B', 'E'],
  );
  assert.equal(interfaces[2].reason, 'low-to-high');
  assert.equal(interfaces[3].reason, 'path-limited');
  closeTo(interfaces[3].maxInvariant, 1.3);
});

test('critical-angle equality is grazing refraction rather than TIR across custom indices', () => {
  for (const [n1, n2] of [[1.5, 1], [1.005, 1.004], [1.032, 1.016], [1.7, 1.5], [2.42, 1.333]]) {
    const criticalDeg = Math.asin(n2 / n1) * 180 / Math.PI;
    const atCritical = solveOptics({ n1, n2, incidentDeg: criticalDeg });
    const aboveCritical = solveOptics({ n1, n2, incidentDeg: criticalDeg + 1e-7 });

    assert.equal(atCritical.totalInternalReflection, false, `${n1} → ${n2} equality`);
    assert.equal(atCritical.atCritical, true, `${n1} → ${n2} equality marker`);
    closeTo(atCritical.refractedDeg, 90, 1e-6);
    assert.equal(aboveCritical.totalInternalReflection, true, `${n1} → ${n2} above critical`);
  }
});

test('normal-incidence Fresnel reflectance matches the analytical value', () => {
  const result = solveOptics({ n1: 1, n2: 1.5, incidentDeg: 0 });

  closeTo(result.reflectance, 0.04);
  closeTo(result.transmittance, 0.96);
});

test('scientific APIs reject malformed states and indices', () => {
  for (const invalid of [null, undefined, [], 'state', 3]) {
    assert.throws(() => solveOptics(invalid), RangeError);
  }
  for (const invalidN of [NaN, Infinity, 0.9, 3.1, '1.5', null]) {
    assert.throws(() => solveOptics({ n1: invalidN, n2: 1.5, incidentDeg: 20 }), RangeError);
  }
  assert.throws(() => classifyInterfaces([1.5]), RangeError);
  assert.throws(() => classifyInterfaces([1.5, '1.3']), RangeError);
});

test('seven media produce six reached interface events with conserved Snell invariant and energy', () => {
  const indices = [1.7, 1.5, 1.3, 1.6, 1.4, 1.2, 1.0];
  const trace = traceLayerStack({ indices, incidentDeg: 30 });
  const invariant = indices[0] * Math.sin(30 * Math.PI / 180);

  assert.equal(trace.events.length, 6);
  assert.deepEqual(trace.events.map((event) => event.label), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(trace.events.every((event) => event.reached), true);
  assert.equal(trace.termination, 'exited-bottom');
  assert.equal(trace.terminatedAt, null);
  for (const event of trace.events) {
    closeTo(event.n1 * Math.sin(event.incidentDeg * Math.PI / 180), invariant, 1e-10);
    closeTo(event.incomingPower, event.reflectedPower + event.transmittedPower, 1e-12);
    assert.equal(event.totalInternalReflection, false);
  }
  closeTo(trace.exitPower, trace.events.at(-1).transmittedPower, 1e-12);
  assert.ok(trace.exitPower > 0 && trace.exitPower < 1);
});

test('the downward primary ray stops at the first total-internal-reflection interface', () => {
  const trace = traceLayerStack({
    indices: [1.7, 1.5, 1.3, 1.6, 1.4, 1.2, 1.0],
    incidentDeg: 45,
  });

  assert.deepEqual(trace.events.filter((event) => event.reached).map((event) => event.label), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(trace.events[4].totalInternalReflection, true);
  closeTo(trace.events[4].reflectedPower, trace.events[4].incomingPower, 1e-12);
  assert.equal(trace.events[4].transmittedPower, 0);
  assert.equal(trace.events[5].reached, false);
  assert.equal(trace.events[5].blockedBy, 'E');
  assert.equal(trace.termination, 'total-internal-reflection');
  assert.equal(trace.terminatedAt, 'E');
  assert.equal(trace.exitPower, 0);
});

test('critical-angle grazing propagation does not falsely reach the next parallel interface', () => {
  const criticalDeg = Math.asin(1 / 1.5) * 180 / Math.PI;
  const trace = traceLayerStack({
    indices: [1.5, 1, 1, 1, 1, 1, 1],
    incidentDeg: criticalDeg,
  });

  assert.equal(trace.events[0].reached, true);
  assert.equal(trace.events[0].atCritical, true);
  assert.equal(trace.events[0].totalInternalReflection, false);
  closeTo(trace.events[0].refractedDeg, 90, 1e-6);
  assert.equal(trace.events[1].reached, false);
  assert.equal(trace.events[1].blockedBy, 'A');
  assert.equal(trace.termination, 'grazing');
  assert.equal(trace.terminatedAt, 'A');
  assert.equal(trace.exitPower, 0);
});

test('six-interface trace validates exactly seven physical media and immutable output', () => {
  assert.throws(() => traceLayerStack({ indices: [1, 1.5], incidentDeg: 20 }), RangeError);
  assert.throws(() => traceLayerStack({ indices: Array(7).fill(1.5), incidentDeg: 75.1 }), RangeError);
  assert.throws(() => traceLayerStack({ indices: Array(7).fill(1.5), incidentDeg: 90 }), RangeError);
  assert.throws(() => traceLayerStack({ indices: [1, 1.5, 1.3, 1.2, 1.1, 1.4, '1.5'], incidentDeg: 20 }), RangeError);

  const trace = traceLayerStack({ indices: Array(7).fill(1.5), incidentDeg: 60 });
  assert.equal(Object.isFrozen(trace), true);
  assert.equal(Object.isFrozen(trace.indices), true);
  assert.equal(Object.isFrozen(trace.events), true);
  assert.equal(trace.events.every((event) => Object.isFrozen(event)), true);
  assert.equal(trace.events.every((event) => event.reflectedPower === 0), true);
  assert.equal(trace.events.every((event) => event.transmittedPower === 1), true);
  closeTo(trace.exitPower, 1);
});
