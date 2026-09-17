const DEG = Math.PI / 180;

function requireIndex(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 3) {
    throw new RangeError(`${label} must be a finite number from 1 to 3`);
  }
  return value;
}

function requireAngle(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 90) {
    throw new RangeError('incidentDeg must be a finite number from 0 up to but not including 90');
  }
  return value;
}

export function classifyInterfaces(indices) {
  if (!Array.isArray(indices) || indices.length < 2 || indices.length > 27) {
    throw new RangeError('indices must contain 2 to 27 refractive indices');
  }
  const clean = indices.map((value, index) => requireIndex(value, `indices[${index}]`));
  return Object.freeze(clean.slice(0, -1).map((n1, index) => {
    const n2 = clean[index + 1];
    return Object.freeze({
      label: String.fromCharCode(65 + index),
      n1,
      n2,
      canTir: n1 > n2,
      reason: n1 > n2 ? 'high-to-low' : n1 < n2 ? 'low-to-high' : 'equal-index',
      criticalDeg: n1 > n2 ? Math.asin(n2 / n1) / DEG : null,
    });
  }));
}

export function solveOptics(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new RangeError('state must be an object');
  }

  const n1 = requireIndex(state.n1, 'n1');
  const n2 = requireIndex(state.n2, 'n2');
  const incidentDeg = requireAngle(state.incidentDeg);
  const sinTheta2 = (n1 / n2) * Math.sin(incidentDeg * DEG);
  const totalInternalReflection = sinTheta2 > 1;
  const theta1 = incidentDeg * DEG;
  const theta2 = totalInternalReflection
    ? null
    : Math.asin(Math.min(1, sinTheta2));
  const refractedDeg = theta2 === null ? null : theta2 / DEG;
  const criticalDeg = n1 > n2 ? Math.asin(n2 / n1) / DEG : null;

  let reflectance = 1;
  if (!totalInternalReflection) {
    const cos1 = Math.cos(theta1);
    const cos2 = Math.cos(theta2);
    const rs = (n1 * cos1 - n2 * cos2) / (n1 * cos1 + n2 * cos2);
    const rp = (n1 * cos2 - n2 * cos1) / (n1 * cos2 + n2 * cos1);
    reflectance = (rs ** 2 + rp ** 2) / 2;
  }
  const transmittance = 1 - reflectance;

  let bending = 'none';
  if (totalInternalReflection) bending = 'total-internal-reflection';
  else if (incidentDeg > 0 && n2 > n1) bending = 'toward-normal';
  else if (incidentDeg > 0 && n2 < n1) bending = 'away-from-normal';

  return Object.freeze({
    n1,
    n2,
    incidentDeg,
    reflectedDeg: incidentDeg,
    refractedDeg,
    criticalDeg,
    totalInternalReflection,
    reflectance,
    transmittance,
    bending,
  });
}
