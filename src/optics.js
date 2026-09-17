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
  let maxInvariant = clean[0];
  const interfaces = clean.slice(0, -1).map((n1, index) => {
    const n2 = clean[index + 1];
    const localCanTir = n1 > n2;
    const canTir = maxInvariant > n2;
    let reason = 'equal-index';
    if (canTir) reason = 'reachable-high-to-low';
    else if (n1 < n2) reason = 'low-to-high';
    else if (localCanTir) reason = 'path-limited';
    const entry = Object.freeze({
      label: String.fromCharCode(65 + index),
      n1,
      n2,
      localCanTir,
      canTir,
      reason,
      maxInvariant,
      maxIncidentDeg: Math.asin(Math.min(1, maxInvariant / n1)) / DEG,
      criticalDeg: localCanTir ? Math.asin(n2 / n1) / DEG : null,
    });
    maxInvariant = Math.min(maxInvariant, n2);
    return entry;
  });
  return Object.freeze(interfaces);
}

export function solveOptics(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new RangeError('state must be an object');
  }

  const n1 = requireIndex(state.n1, 'n1');
  const n2 = requireIndex(state.n2, 'n2');
  const incidentDeg = requireAngle(state.incidentDeg);
  const theta1 = incidentDeg * DEG;
  const sinTheta2 = (n1 / n2) * Math.sin(theta1);
  const criticalDeg = n1 > n2 ? Math.asin(n2 / n1) / DEG : null;
  const angleTolerance = 16 * Number.EPSILON
    * Math.max(1, Math.abs(incidentDeg), Math.abs(criticalDeg ?? 0));
  const criticalDelta = criticalDeg === null ? null : incidentDeg - criticalDeg;
  const atCritical = criticalDelta !== null && Math.abs(criticalDelta) <= angleTolerance;
  const totalInternalReflection = criticalDelta !== null && criticalDelta > angleTolerance;
  const theta2 = totalInternalReflection
    ? null
    : atCritical ? Math.PI / 2 : Math.asin(Math.max(-1, Math.min(1, sinTheta2)));
  const refractedDeg = theta2 === null ? null : theta2 / DEG;

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
    atCritical,
    totalInternalReflection,
    reflectance,
    transmittance,
    bending,
  });
}
