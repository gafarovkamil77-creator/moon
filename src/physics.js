export const G0 = 9.80665;
export const PRESETS = {
  training: { altitude: 700, vx: 0, vy: -12, fuel: 820, dryMass: 1800, maxThrust: 12000, isp: 305, gravity: 1.625, x: 0 },
  approach: { altitude: 1600, vx: 18, vy: -28, fuel: 1000, dryMass: 1800, maxThrust: 12000, isp: 305, gravity: 1.625, x: -450 },
  hard: { altitude: 900, vx: 24, vy: -38, fuel: 450, dryMass: 1800, maxThrust: 12000, isp: 305, gravity: 1.625, x: -300 }
};
export function createState(config = PRESETS.training) {
  return { ...config, y: config.altitude, time: 0, angle: 0, throttle: 0, ax: 0, ay: -config.gravity, thrust: 0, flow: 0, status: 'ready', outcome: null };
}
export function metrics(s) {
  const mass = s.dryMass + s.fuel;
  const weight = mass * s.gravity;
  const verticalMax = s.maxThrust * Math.cos(s.angle * Math.PI / 180) / mass - s.gravity;
  return {
    mass, weight, speed: Math.hypot(s.vx, s.vy),
    hover: weight / (s.maxThrust * Math.cos(s.angle * Math.PI / 180)) * 100,
    twr: s.thrust / weight,
    stopping: s.vy < 0 && verticalMax > 0 && s.fuel > 0 ? s.vy * s.vy / (2 * verticalMax) : s.vy >= 0 ? 0 : Infinity,
    burnTime: s.flow > 0 ? s.fuel / s.flow : Infinity,
    deltaV: G0 * s.isp * Math.log(mass / s.dryMass)
  };
}
export function step(s, dt) {
  if (s.status !== 'flying' || dt <= 0) return s;
  const previousY = s.y;
  const demand = s.maxThrust * s.throttle / 100;
  const used = Math.min(s.fuel, demand / (s.isp * G0) * dt);
  s.thrust = used * s.isp * G0 / dt;
  s.flow = used / dt;
  const mass = s.dryMass + s.fuel - used / 2;
  const angle = s.angle * Math.PI / 180;
  s.ax = s.thrust * Math.sin(angle) / mass;
  s.ay = s.thrust * Math.cos(angle) / mass - s.gravity;
  s.x += s.vx * dt + 0.5 * s.ax * dt * dt;
  s.y += s.vy * dt + 0.5 * s.ay * dt * dt;
  s.vx += s.ax * dt;
  s.vy += s.ay * dt;
  s.fuel -= used;
  s.time += dt;
  if (s.y <= 0) {
    // Recover the contact instant within the integration step.
    const a = 0.5 * s.ay;
    const oldVy = s.vy - s.ay * dt;
    const disc = oldVy * oldVy - 4 * a * previousY;
    const hit = Math.abs(a) < 1e-10 ? -previousY / oldVy : 2 * previousY / (-oldVy + Math.sqrt(Math.max(0, disc)));
    const remainder = dt - Math.max(0, Math.min(dt, hit));
    s.x -= s.vx * remainder - 0.5 * s.ax * remainder * remainder;
    s.vx -= s.ax * remainder;
    s.vy -= s.ay * remainder;
    s.fuel += s.flow * remainder;
    s.time -= remainder;
    s.y = 0;
    const safe = Math.abs(s.vy) <= 2 && Math.abs(s.vx) <= 1 && Math.abs(s.angle) <= 8;
    const onPad = Math.abs(s.x) <= 40;
    s.outcome = { safe, onPad, vx: s.vx, vy: s.vy, angle: s.angle, x: s.x };
    s.status = safe ? 'landed' : 'crashed';
    s.thrust = 0;
    s.flow = 0;
  }
  return s;
}
