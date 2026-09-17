import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyInterfaces, solveOptics } from '../src/optics.js';

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

test('six-layer question identifies only high-to-low interfaces as TIR candidates', () => {
  const interfaces = classifyInterfaces([1.7, 1.5, 1.3, 1.6, 1.4, 1.0]);

  assert.deepEqual(
    interfaces.filter((entry) => entry.canTir).map((entry) => entry.label),
    ['A', 'B', 'D', 'E'],
  );
  assert.equal(interfaces[2].reason, 'low-to-high');
});

test('critical-angle equality is grazing refraction rather than TIR', () => {
  const criticalDeg = Math.asin(1 / 1.5) * 180 / Math.PI;
  const result = solveOptics({ n1: 1.5, n2: 1, incidentDeg: criticalDeg });

  assert.equal(result.totalInternalReflection, false);
  closeTo(result.refractedDeg, 90, 1e-7);
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
