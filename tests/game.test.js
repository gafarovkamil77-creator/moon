import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, createState, step } from '../src/physics.js';
import { guidance, predictContact, landingScore } from '../src/game.js';

for (const [name, config] of Object.entries(PRESETS)) {
  test(`autopilot lands safely on target in ${name}`, () => {
    const s = createState(config);
    s.status = 'flying';
    for (let i = 0; i < 120 * 240 && s.status === 'flying'; i++) {
      const control = guidance(s);
      s.throttle = control.throttle;
      s.angle = control.angle;
      step(s, 1 / 120);
    }
    assert.equal(s.status, 'landed', JSON.stringify(s.outcome));
    assert.equal(s.outcome.onPad, true);
    assert.ok(s.fuel > 0);
  });
}
test('prediction agrees with analytical free fall and rejects trajectories without future contact', () => {
  const s = createState({ ...PRESETS.training, altitude: 10, vy: 0, vx: 2 });
  const p = predictContact(s);
  assert.ok(Math.abs(p.time - Math.sqrt(20 / 1.625)) < 1e-8);
  assert.ok(Math.abs(p.x - p.time * 2) < 1e-8);
  s.ay = 2; s.vy = 5;
  assert.equal(predictContact(s), null);
});
test('narrow mission pad is respected at contact', () => {
  const s = createState({ ...PRESETS.precision, altitude: .01, vy: -.1, vx: 0, x: 15 });
  s.status = 'flying'; step(s, .1);
  assert.equal(s.status, 'landed');
  assert.equal(s.outcome.onPad, false);
});
test('scoring rewards precision and economy and separates automation', () => {
  const s = createState();
  s.outcome = { safe: true, onPad: true, x: 0, vx: 0, vy: 0 };
  assert.equal(landingScore(s, 820).total, 5000);
  assert.equal(landingScore(s, 820, 'auto').eligible, false);
  assert.equal(landingScore(s, 820, 'assist').total, 3250);
  s.outcome.x = 35; s.outcome.vy = -1.8; s.fuel = 10;
  assert.ok(landingScore(s, 820).total < 2500);
  s.outcome.safe = false;
  assert.equal(landingScore(s, 820).total, 0);
});
test('autopilot respects actuator limits and cannot create fuel', () => {
  const s = createState({ ...PRESETS.training, fuel: 0, altitude: 20, vy: -30 });
  s.status = 'flying';
  for (let i = 0; i < 120 && s.status === 'flying'; i++) {
    const c = guidance(s);
    assert.ok(c.throttle >= 0 && c.throttle <= 100);
    assert.ok(Math.abs(c.angle) <= 35);
    Object.assign(s, { throttle: c.throttle, angle: c.angle });
    step(s, 1 / 120);
  }
  assert.equal(s.status, 'crashed');
  assert.equal(s.fuel, 0);
});
test('impact telemetry preserves engine state before shutdown', () => {
  const s = createState({ ...PRESETS.training, altitude: .01, vy: -.5 });
  Object.assign(s, { status: 'flying', throttle: 35 });
  for (let i = 0; i < 120 && s.status === 'flying'; i++) step(s, 1 / 120);
  assert.equal(s.status, 'landed');
  assert.equal(s.thrust, 0);
  assert.equal(s.flow, 0);
  assert.ok(Math.abs(s.outcome.thrust - 4200) < 1e-6);
  assert.ok(s.outcome.flow > 0);
  assert.equal(s.outcome.ay, s.ay);
});
