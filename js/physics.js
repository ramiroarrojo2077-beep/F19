// Modelo de dinámica arcade de un F1 (unidades SI: metros, segundos).
import { clamp, damp } from './utils.js';

export const G = 9.81;
export const WHEELBASE = 3.6;
export const CAR_HALF_WIDTH = 1.0;
export const MAX_RPM = 12500;
export const IDLE_RPM = 4200;

// Velocidad máxima (m/s) de cada marcha: define RPM y cambios automáticos.
export const GEAR_TOP = [0, 22, 33, 43, 53, 63, 73, 84, 100];

export const SURFACE = { ROAD: 0, KERB: 1, GRASS: 2, GRAVEL: 3, RUNOFF: 4 };
const SURF_GRIP = [1, 0.92, 0.55, 0.42, 0.86];
const SURF_TRACTION = [1, 0.95, 0.6, 0.45, 0.92];

// Agarre lateral máximo (m/s²): mecánico + carga aerodinámica.
export function latGrip(v) {
  return G * Math.min(5.6, 1.65 + 0.00068 * v * v);
}
export function brakeDecel(v) {
  return G * Math.min(5.3, 1.8 + 0.00042 * v * v);
}
export function engineAccel(v) {
  return Math.min(13.5, 960 / Math.max(v, 1));
}
export function dragDecel(v, drs) {
  return 0.00112 * (drs ? 0.84 : 1) * v * v + 0.35;
}
function surfaceDrag(surf, v) {
  if (surf === SURFACE.GRASS) return 2.5 + 0.0022 * v * v;
  if (surf === SURFACE.GRAVEL) return 9 + 0.004 * v * v;
  return 0;
}

// Velocidad máxima de paso por curva para una curvatura dada.
export function cornerSpeed(kappa, gripMul = 1) {
  const k = Math.abs(kappa);
  if (k < 1e-5) return 110;
  let v = 30;
  for (let i = 0; i < 24; i++) v = Math.sqrt((latGrip(v) * gripMul) / k);
  return Math.min(v, 110);
}

export function steerLimit(v) {
  return 0.42 / (1 + Math.abs(v) / 15);
}

// Avanza la simulación de un auto dt segundos.
// inp: { throttle 0..1, brake 0..1, steer -1..1 (+ derecha) }
export function stepCar(car, inp, dt) {
  const vAbs = Math.abs(car.speed);
  const surf = car.surface;
  const gripMul = SURF_GRIP[surf] * (car.gripMul || 1);

  // Dirección (ángulo positivo = izquierda)
  const target = -inp.steer * steerLimit(car.speed);
  car.steerAngle = damp(car.steerAngle, target, 14, dt);

  // Guiñada limitada por el agarre disponible
  const rDes = (car.speed * Math.tan(car.steerAngle)) / WHEELBASE;
  const maxLat = latGrip(vAbs) * gripMul;
  const rMax = maxLat / Math.max(vAbs, 0.5);
  car.understeer = vAbs > 6 ? Math.max(0, Math.abs(rDes) - rMax) / rMax : 0;
  const r = clamp(rDes, -rMax, rMax);
  car.yawRate = damp(car.yawRate, r, 12, dt);
  car.heading += car.yawRate * dt;

  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const sx = fz, sz = -fx; // izquierda
  let vf = car.vx * fx + car.vz * fz;
  let vs = car.vx * sx + car.vz * sz;

  // Uso del círculo de fricción por el giro
  const latUse = Math.min(1, Math.abs(car.yawRate * vf) / Math.max(maxLat, 1));
  const longAvail = Math.sqrt(Math.max(0.25, 1 - 0.55 * latUse * latUse));

  let a = 0;
  const thr = inp.throttle, brk = inp.brake;
  if (vf >= -0.5) {
    if (thr > 0) a += thr * engineAccel(Math.max(vf, 0)) * SURF_TRACTION[surf] * (car.powerMul || 1);
    if (brk > 0) {
      if (vf > 0.6) a -= brk * brakeDecel(vf) * longAvail * (surf === SURFACE.ROAD ? 1 : surf === SURFACE.RUNOFF ? 0.85 : 0.65);
      else if (thr < 0.1) a -= brk * 5; // marcha atrás
    }
  } else {
    // en marcha atrás: acelerador frena, freno acelera hacia atrás
    if (thr > 0) a += thr * 12;
    if (brk > 0 && thr < 0.1) a -= brk * 4;
  }
  // pendiente: la gravedad empuja cuesta abajo
  a -= G * (car.grade || 0);
  const resist = dragDecel(Math.abs(vf), car.drsOpen) + surfaceDrag(surf, Math.abs(vf));
  const before = vf;
  vf += a * dt;
  // Resistencias: siempre se oponen al movimiento sin invertir el sentido
  const dragStep = resist * dt;
  if (vf > 0) vf = Math.max(0, vf - dragStep);
  else if (vf < 0) vf = Math.min(0, vf + dragStep);
  if (vf < -14) vf = -14;
  car.longAccel = (vf - before) / dt;

  // Agarre lateral: elimina el deslizamiento hasta el límite de adherencia
  const latRemove = maxLat * 1.15 * dt;
  car.slip = Math.abs(vs);
  if (Math.abs(vs) <= latRemove) vs = 0;
  else vs -= Math.sign(vs) * latRemove;

  car.vx = fx * vf + sx * vs;
  car.vz = fz * vf + sz * vs;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = vf;
  car.latAccel = car.yawRate * vf;
}

export function gearFor(v) {
  const s = Math.abs(v);
  for (let g = 1; g < GEAR_TOP.length; g++) if (s < GEAR_TOP[g] * 0.97) return g;
  return GEAR_TOP.length - 1;
}

export function rpmFor(v, gear) {
  return Math.max(IDLE_RPM, (MAX_RPM * Math.abs(v)) / GEAR_TOP[gear]);
}
