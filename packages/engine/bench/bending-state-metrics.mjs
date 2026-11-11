// Linear bending comparator: the actual initial out-of-plane field decomposed onto every mode of the
// independent flat-state spectrum, then propagated two ways from that same field:
//   continuous: q_k(t) = c_k cos(omega_k t) + (d_k / omega_k) sin(omega_k t)   (rigid modes: c_k + d_k t)
//   discrete:   backward Euler with real M/h^2, per mode
//               q_{n+1} = (q_n + h p_n) / (1 + omega_k^2 h^2),  p_{n+1} = (q_{n+1} - q_n) / h.
// Two scopes. outOfPlane (gated): the out-of-plane field and velocity against the reference, and
// the linear energy (bending + out-of-plane kinetic) against the modal energy; this is the linear
// theory's domain. full (reported): mass norms over the whole 3D field and elastic + kinetic energy,
// so in-plane motion and membrane energy, which the linear reference does not have, count as error;
// at finite amplitude they are the second-order membrane coupling. This checks the integrator against
// the represented discrete law at small amplitude; it is not plate theory, material calibration or
// exact native-coefficient propagation.

const finite = x => typeof x === 'number' && Number.isFinite(x);
const demand = (ok, message) => { if (!ok) throw new Error('bending-state-metrics: ' + message); };

/** Modal coordinates of the actual initial field and velocity on every reference mode. */
export function bendingComparatorSetup(context, spectrum, initial) {
  const { masses, omega, amplitude, modalMass } = context, n = masses.length;
  demand(Array.isArray(spectrum) && spectrum.length === n, 'one reference mode per out-of-plane degree of freedom required');
  const modes = spectrum.map(m => {
    const phi = m.phiBinary64, mass = masses.reduce((s, mi, i) => s + mi * phi[i] * phi[i], 0);
    demand(phi.length === n && phi.every(finite) && mass > 0, 'invalid reference mode');
    let c = 0, d = 0;
    for (let i = 0; i < n; i++) { c += masses[i] * phi[i] * initial.u[3 * i + 1]; d += masses[i] * phi[i] * initial.v[3 * i + 1]; }
    return { phi, omega: m.rigid ? 0 : m.omegaBinary64, rigid: m.rigid, modalMass: mass, c: c / mass, d: d / mass };
  });
  for (let i = 0; i < n; i++) demand(initial.u[3 * i] === 0 && initial.u[3 * i + 2] === 0 && initial.v[3 * i] === 0 && initial.v[3 * i + 2] === 0, 'initial in-plane field must be zero');
  const reconstruction = Math.sqrt(masses.reduce((s, mi, i) => s + mi * (initial.u[3 * i + 1] - modes.reduce((t, m) => t + m.c * m.phi[i], 0)) ** 2, 0));
  const scale = { displacement: Math.abs(amplitude) * Math.sqrt(modalMass), velocity: Math.abs(amplitude) * omega * Math.sqrt(modalMass), energy: .5 * modalMass * (amplitude * omega) ** 2 };
  demand(reconstruction <= 1e-10 * scale.displacement, 'initial field is not spanned by the reference spectrum');
  return { modes, scale, reconstructionMassNorm: reconstruction, discrete: modes.map(m => ({ q: m.c, p: m.d })) };
}

/** Advance the per-mode backward-Euler reference one step with the actual nominal h. */
export function advanceBackwardEuler(setup, h) {
  setup.discrete = setup.discrete.map((s, k) => {
    const w = setup.modes[k].omega, q = (s.q + h * s.p) / (1 + w * w * h * h);
    return { q, p: (q - s.q) / h };
  });
}

function referenceField(setup, coordinates) {
  const n = setup.modes[0].phi.length, y = new Array(n).fill(0), v = new Array(n).fill(0); let energy = 0;
  coordinates.forEach(({ q, p }, k) => {
    const m = setup.modes[k];
    for (let i = 0; i < n; i++) { y[i] += q * m.phi[i]; v[i] += p * m.phi[i]; }
    energy += .5 * m.modalMass * (m.omega * m.omega * q * q + p * p);
  });
  return { y, v, energy };
}
function continuousCoordinates(setup, t) {
  return setup.modes.map(m => m.rigid ? { q: m.c + m.d * t, p: m.d }
    : { q: m.c * Math.cos(m.omega * t) + m.d / m.omega * Math.sin(m.omega * t), p: -m.c * m.omega * Math.sin(m.omega * t) + m.d * Math.cos(m.omega * t) });
}

/** Errors of one engine state against both references at the actual accumulated clock.
 * @param {{u: ArrayLike<number>, v: ArrayLike<number>, elasticEnergy: number|null, bendingEnergy: number|null, time: number}} state */
export function measureBendingState(context, setup, { u, v, elasticEnergy, bendingEnergy, time }) {
  const { masses, omega, phi, modalMass } = context, n = masses.length;
  let kineticY = 0, kineticInPlane = 0;
  for (let i = 0; i < n; i++) { kineticY += .5 * masses[i] * v[3 * i + 1] ** 2; kineticInPlane += .5 * masses[i] * (v[3 * i] ** 2 + v[3 * i + 2] ** 2); }
  const compare = reference => {
    let fieldY = 0, velocityY = 0, fieldIn = 0, velocityIn = 0;
    for (let i = 0; i < n; i++) {
      fieldY += masses[i] * (u[3 * i + 1] - reference.y[i]) ** 2; velocityY += masses[i] * (v[3 * i + 1] - reference.v[i]) ** 2;
      fieldIn += masses[i] * (u[3 * i] ** 2 + u[3 * i + 2] ** 2); velocityIn += masses[i] * (v[3 * i] ** 2 + v[3 * i + 2] ** 2);
    }
    const s = setup.scale, scoped = (field, velocity, energy) => {
      const displacement = Math.sqrt(field) / s.displacement, speed = Math.sqrt(velocity) / s.velocity;
      return { displacement, velocity: speed, state: Math.hypot(displacement, speed), energy: energy === null ? null : Math.abs(energy - reference.energy) / s.energy };
    };
    return { outOfPlane: scoped(fieldY, velocityY, bendingEnergy === null ? null : bendingEnergy + kineticY),
      full: scoped(fieldY + fieldIn, velocityY + velocityIn, elasticEnergy === null ? null : elasticEnergy + kineticY + kineticInPlane), referenceEnergy: reference.energy };
  };
  let q = 0, qdot = 0;
  for (let i = 0; i < n; i++) { q += masses[i] * phi[i] * u[3 * i + 1]; qdot += masses[i] * phi[i] * v[3 * i + 1]; }
  q /= modalMass; qdot /= modalMass;
  const continuous = compare(referenceField(setup, continuousCoordinates(setup, time)));
  const phaseObservable = Math.hypot(q, qdot / omega) > 1e-3 * Math.abs(context.amplitude);
  const coupling = elasticEnergy === null || bendingEnergy === null ? null : (elasticEnergy - bendingEnergy + kineticInPlane) / setup.scale.energy;
  return { time, modalCoordinate: q, modalVelocity: qdot, actualPhase: phaseObservable ? Math.atan2(-qdot / omega, q) : null,
    membraneCouplingEnergyRelative: coupling,
    errors: { backwardEuler: compare(referenceField(setup, setup.discrete)), continuous: { ...continuous, phaseObservable } } };
}
