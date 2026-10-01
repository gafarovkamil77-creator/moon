import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, createState, step, metrics, G0 } from '../src/physics.js';

const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function fly(config, seconds, throttle = 0, angle = 0, dt = 1 / 120) {
  const s = createState(config);
  Object.assign(s, { status: 'flying', throttle, angle });
  for (let i = 0; i < Math.round(seconds / dt) && s.status === 'flying'; i++) step(s, dt);
  return s;
}
test('unpowered flight follows the lunar free-fall equations', () => {
  const s = fly(PRESETS.training, 10);
  close(s.y, 700 - 12 * 10 - .5 * 1.625 * 100);
  close(s.vy, -12 - 1.625 * 10);
  close(s.fuel, 820);
});
test('engine fuel consumption matches thrust and specific impulse', () => {
  const s = fly(PRESETS.training, 5, 80);
  close(s.fuel, 820 - 12000 * .8 / (305 * G0) * 5);
  assert.ok(s.vy > -12);
  close(s.vx, 0);
});
test('tilt produces the expected horizontal acceleration', () => {
  const s = fly(PRESETS.training, 1 / 120, 100, 30);
  const used = 12000 / (305 * G0) / 120;
  close(s.ax, 12000 * .5 / (2620 - used / 2));
  close(s.ay, 12000 * Math.cos(Math.PI / 6) / (2620 - used / 2) - 1.625);
});
test('fuel exhaustion never yields negative fuel or unearned thrust', () => {
  const s = fly({ ...PRESETS.training, fuel: .001 }, 1, 100);
  close(s.fuel, 0);
  close(s.thrust, 0);
  close(s.ay, -1.625);
});
test('contact time and impact velocity match analytical free fall', () => {
  const s = fly({ ...PRESETS.training, altitude: 10, vy: 0 }, 10);
  assert.equal(s.status, 'crashed');
  close(s.y, 0);
  close(s.time, Math.sqrt(20 / 1.625));
  close(s.outcome.vy, -Math.sqrt(20 * 1.625));
});
test('soft landing, off-target landing and unsafe tilt are distinguished', () => {
  const cfg = { ...PRESETS.training, altitude: .05, vy: -.5 };
  const landed = fly(cfg, 1);
  assert.equal(landed.status, 'landed');
  assert.equal(landed.outcome.onPad, true);
  const missed = fly({ ...cfg, x: 100 }, 1);
  assert.equal(missed.status, 'landed');
  assert.equal(missed.outcome.onPad, false);
  assert.equal(fly(cfg, 1, 0, 20).status, 'crashed');
  assert.equal(fly({ ...cfg, vx: 2 }, 1).status, 'crashed');
});
test('paused and completed flights do not advance', () => {
  const s = createState();
  s.status = 'paused';
  const before = { ...s };
  step(s, 1);
  assert.deepEqual(s, before);
});
test('delta-v follows Tsiolkovsky and stopping height handles insufficient thrust', () => {
  const s = createState();
  close(metrics(s).deltaV, 305 * G0 * Math.log(2620 / 1800));
  close(metrics(s).stopping, 144 / (2 * (12000 / 2620 - 1.625)));
  s.fuel = 0;
  assert.equal(metrics(s).stopping, Infinity);
  close(metrics(s).deltaV, 0);
});
test('powered flight converges as the integration step decreases', () => {
  const a = fly(PRESETS.training, 8, 70, 12, 1 / 120);
  const b = fly(PRESETS.training, 8, 70, 12, 1 / 240);
  close(a.y, b.y, .002);
  close(a.vy, b.vy, .0001);
  close(a.x, b.x, .002);
});
test('hover throttle compensates for the vertical component of tilted thrust', () => {
  const s = createState();
  s.angle = 60;
  close(metrics(s).hover, (2620 * 1.625 / 12000) * 200);
});
