import { PRESETS, createState, metrics, step } from './physics.js';

const $ = id => document.getElementById(id);
const fmt = (v, digits = 1) => Number.isFinite(v) ? v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '∞';
let config = { ...PRESETS.training };
let state = createState(config);
let history = [];
let accumulator = 0;
let lastFrame = 0;
let lastSample = -1;
const fixedDt = 1 / 120;
const names = { ready: 'ОЖИДАНИЕ СТАРТА', flying: 'СПУСК НА ПОВЕРХНОСТЬ', paused: 'ПОЛЁТ ПРИОСТАНОВЛЕН', landed: 'КАСАНИЕ ПОВЕРХНОСТИ', crashed: 'АВАРИЙНАЯ ПОСАДКА' };

function sample() {
  history.push({ time: state.time, x: state.x, altitude: state.y, vx: state.vx, vy: state.vy, fuel: state.fuel, throttle: state.throttle, angle: state.angle, ax: state.ax, ay: state.ay });
  lastSample = state.time;
}
function fillForm() {
  for (const [key, value] of Object.entries(config)) if ($('config-form').elements.namedItem(key)) $('config-form').elements.namedItem(key).value = value;
}
function reset() {
  state = createState(config);
  history = [];
  lastSample = -1;
  accumulator = 0;
  $('throttle').value = 0;
  $('angle').value = 0;
  $('result').hidden = true;
  sample();
  update();
}
function toggleFlight() {
  if (state.status === 'ready' || state.status === 'paused') state.status = 'flying';
  else if (state.status === 'flying') state.status = 'paused';
  else return;
  accumulator = 0;
  update();
}
$('start').addEventListener('click', toggleFlight);
$('reset').addEventListener('click', reset);
$('preset').addEventListener('change', e => { config = { ...PRESETS[e.target.value] }; fillForm(); reset(); });
$('config-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = new FormData(e.target);
  for (const [key, value] of data) config[key] = Number(value);
  reset();
});
function controls() {
  state.throttle = Number($('throttle').value);
  state.angle = Number($('angle').value);
  update();
}
$('throttle').addEventListener('input', controls);
$('angle').addEventListener('input', controls);
$('level').addEventListener('click', () => { $('angle').value = 0; controls(); });
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) toggleFlight(); }
  if (state.status === 'landed' || state.status === 'crashed') return;
  const keys = { ArrowUp: ['throttle', 2], ArrowDown: ['throttle', -2], ArrowLeft: ['angle', -2], ArrowRight: ['angle', 2] };
  if (keys[e.code]) {
    e.preventDefault();
    const [id, delta] = keys[e.code];
    const input = $(id);
    input.value = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) + delta));
    controls();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.status === 'flying') toggleFlight(); });

function update() {
  const m = metrics(state);
  const values = {
    height: fmt(state.y), vy: fmt(state.vy, 2), vx: fmt(state.vx, 2), ay: fmt(state.ay, 3), fuel: fmt(state.fuel, 0),
    'throttle-value': state.throttle, 'angle-value': state.angle,
    'hover-label': m.hover > 100 ? 'Зависание недоступно' : `Зависание ≈ ${fmt(m.hover, 0)}%`,
    offset: `Смещение от цели: ${fmt(state.x)} м`,
    force: `${fmt(state.thrust, 0)} Н`, mass: `${fmt(m.mass, 0)} кг`, twr: fmt(m.twr, 2),
    'delta-v': `${fmt(m.deltaV, 0)} м/с`, flow: `${fmt(state.flow, 2)} кг/с`,
    'burn-time': Number.isFinite(m.burnTime) ? `${fmt(m.burnTime, 0)} с` : '—',
    stopping: Number.isFinite(m.stopping) ? `${fmt(m.stopping)} м` : 'Недостаточно тяги',
    margin: Number.isFinite(m.stopping) ? `${fmt(state.y - m.stopping)} м` : '—',
    'descent-status': state.status === 'landed' ? 'Касание' : state.status === 'crashed' ? 'Авария' : state.vy >= 0 ? 'Набор высоты' : state.y < m.stopping ? 'Пора тормозить' : 'Есть запас высоты',
    'flight-status': names[state.status],
    'telemetry-status': state.status === 'ready' ? 'ГОТОВ К ПОЛЁТУ' : state.status === 'flying' ? 'LIVE / 120 ГЦ' : names[state.status],
    'fuel-note': state.fuel <= 0 ? 'Топливо израсходовано' : state.flow > 0 ? `Расход ${fmt(state.flow, 2)} кг/с` : 'Двигатель выключен'
  };
  for (const [id, value] of Object.entries(values)) $(id).textContent = value;
  const minutes = Math.floor(state.time / 60);
  $('mission-time').textContent = `T+ ${String(minutes).padStart(2, '0')}:${(state.time % 60).toFixed(1).padStart(4, '0')}`;
  $('fuel-bar').style.width = `${config.fuel > 0 ? state.fuel / config.fuel * 100 : 0}%`;
  $('fuel-bar').style.background = state.fuel < config.fuel * .15 ? '#fa8a76' : 'var(--accent)';
  const terminal = ['landed', 'crashed'].includes(state.status);
  $('throttle').disabled = terminal;
  $('angle').disabled = terminal;
  $('level').disabled = terminal;
  $('start').disabled = terminal;
  $('start').textContent = state.status === 'flying' ? 'Ⅱ Пауза' : state.status === 'paused' ? '▶︎ Продолжить' : terminal ? 'Полёт завершён' : '▶︎ Начать полёт';
  if (terminal && $('result').hidden) {
    const o = state.outcome;
    $('result').className = `result ${o.safe ? '' : 'crash'}`;
    $('result').innerHTML = `<div class="eyebrow">МИССИЯ ЗАВЕРШЕНА</div><h3>${o.safe ? o.onPad ? 'Мягкая посадка!' : 'Посадка вне цели' : 'Жёсткое касание'}</h3><p>Скорость Y: ${fmt(o.vy, 2)} м/с · X: ${fmt(o.vx, 2)} м/с</p><p>Наклон: ${fmt(o.angle, 0)}° · от цели: ${fmt(o.x)} м</p><p>${o.safe ? o.onPad ? 'Модуль цел. Вы достигли посадочной площадки.' : 'Модуль цел, но площадка осталась в стороне.' : 'Превышены допустимые скорость или наклон.'}</p><small>Нажмите «Новая попытка», чтобы повторить полёт.</small>`;
    $('result').hidden = false;
  }
  chart('height-chart', 'altitude');
  chart('speed-chart', 'vy');
}

function canvasContext(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}
function chart(id, key) {
  const { ctx, width, height } = canvasContext($(id));
  const data = history.slice(-150);
  if (!data.length || !width) return;
  const values = data.map(v => v[key]);
  const min = Math.min(...values), max = Math.max(...values);
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = i / Math.max(1, values.length - 1) * width;
    const y = height - 4 - (value - min) / Math.max(1, max - min) * (height - 8);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#cbf77a'; ctx.lineWidth = 1.4; ctx.stroke();
  if (values.length === 1) { ctx.lineTo(width, height - 4); ctx.stroke(); }
}

function drawScene() {
  const { ctx: c, width: w, height: h } = canvasContext($('scene'));
  if (!w || !h) return;
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#101720'); sky.addColorStop(1, '#1a2431');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  // Stable procedural stars; no random flicker across frames.
  for (let i = 0; i < 110; i++) {
    const x = ((i * 137.508 + 13) % 997) / 997 * w;
    const y = ((i * 79.31 + 7) % 547) / 547 * (h - 55);
    c.fillStyle = `rgba(192,209,229,${.15 + (i % 5) * .09})`;
    c.fillRect(x, y, i % 11 === 0 ? 2 : 1, 1);
  }
  // Distant Earth.
  c.save(); c.translate(w * .76, h * .23); c.rotate(-.4);
  const earth = c.createRadialGradient(-4, -5, 0, 0, 0, 17);
  earth.addColorStop(0, '#789fa8'); earth.addColorStop(.65, '#486a7c'); earth.addColorStop(1, '#253446');
  c.fillStyle = earth; c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#b4bda57a'; c.beginPath(); c.ellipse(-4, -4, 6, 10, -.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#0c111bd0'; c.beginPath(); c.ellipse(8, 1, 10, 15, 0, 0, Math.PI * 2); c.fill(); c.restore();
  const ground = h - 48;
  const scale = (h - 145) / Math.max(config.altitude * 1.08, state.y * 1.2, 120);
  const center = state.x * .65;
  const screenX = x => w * .5 + (x - center) * scale;
  const sx = screenX(state.x), sy = ground - state.y * scale;
  // Altitude grid and labels.
  const tick = 10 ** Math.floor(Math.log10(80 / scale));
  const interval = [1, 2, 5, 10].map(n => n * tick).find(n => n * scale >= 48) || tick * 10;
  c.font = '9px monospace';
  for (let y = interval; y * scale < ground - 75; y += interval) {
    const py = ground - y * scale;
    c.strokeStyle = '#7f98ba10'; c.setLineDash([3, 7]); c.beginPath(); c.moveTo(48, py); c.lineTo(w - 25, py); c.stroke();
    c.fillStyle = '#657388'; c.fillText(`${Math.round(y)} м`, 15, py - 4);
  }
  c.setLineDash([]);
  // Decorative terrain lies below the collision plane.
  c.fillStyle = '#333b46'; c.beginPath(); c.moveTo(0, ground + 8);
  for (let x = 0; x <= w + 10; x += 10) c.lineTo(x, ground + 9 + Math.sin(x * .024) * 5 + Math.sin(x * .079) * 3);
  c.lineTo(w, h); c.lineTo(0, h); c.fill();
  c.fillStyle = '#252e38';
  for (let i = 0; i < 11; i++) { c.beginPath(); c.ellipse((i * 97 + 31) % w, ground + 20 + i % 3 * 6, 10 + i % 4 * 4, 3, -.1, 0, Math.PI * 2); c.fill(); }
  const pad = screenX(0), padHalf = Math.max(23, 40 * scale);
  c.strokeStyle = '#cbf77a'; c.lineWidth = 2; c.beginPath(); c.moveTo(pad - padHalf, ground); c.lineTo(pad + padHalf, ground); c.stroke();
  c.strokeStyle = '#cbf77a66'; c.lineWidth = 1;
  for (const x of [pad - padHalf, pad + padHalf]) { c.beginPath(); c.moveTo(x, ground); c.lineTo(x, ground - 14); c.stroke(); }
  c.fillStyle = '#cbf77a'; c.font = '9px monospace'; c.textAlign = 'center'; c.fillText('H', pad, ground + 17); c.textAlign = 'left';
  if (pad < 0 || pad > w) { c.fillText(pad < 0 ? '← ЦЕЛЬ' : 'ЦЕЛЬ →', pad < 0 ? 14 : w - 75, ground - 20); }
  // Actual flight trail in the same moving coordinate frame.
  c.strokeStyle = '#cbf77a33'; c.lineWidth = 1; c.setLineDash([2, 5]); c.beginPath();
  history.slice(-400).forEach((s, i) => { const x = screenX(s.x), y = ground - s.altitude * scale; if (!i) c.moveTo(x, y); else c.lineTo(x, y); }); c.stroke(); c.setLineDash([]);
  c.strokeStyle = '#cbd6e51c'; c.beginPath(); c.moveTo(sx, sy + 12); c.lineTo(sx, ground); c.stroke();
  // Lander is enlarged for readability; its foot position represents altitude.
  c.save(); c.translate(sx, sy - 22); c.rotate(state.angle * Math.PI / 180);
  if (state.status === 'flying' && state.thrust > 0) {
    const flame = 12 + state.thrust / config.maxThrust * 42 + Math.sin(state.time * 40) * 3;
    const gradient = c.createLinearGradient(0, 12, 0, flame + 16); gradient.addColorStop(0, '#f9edbe'); gradient.addColorStop(.4, '#cbf77acc'); gradient.addColorStop(1, '#cbf77a00');
    c.fillStyle = gradient; c.beginPath(); c.moveTo(-5, 10); c.quadraticCurveTo(-9, 20, 0, flame + 16); c.quadraticCurveTo(9, 20, 5, 10); c.fill();
  }
  c.strokeStyle = '#b8c1cc'; c.lineWidth = 2; c.beginPath(); c.moveTo(-9, 6); c.lineTo(-22, 22); c.lineTo(-28, 22); c.moveTo(9, 6); c.lineTo(22, 22); c.lineTo(28, 22); c.stroke();
  c.fillStyle = '#a9a9a0'; c.beginPath(); c.moveTo(-13, -10); c.lineTo(-9, -20); c.lineTo(9, -20); c.lineTo(13, -10); c.lineTo(12, 8); c.lineTo(-12, 8); c.closePath(); c.fill();
  c.fillStyle = '#d5c291'; c.fillRect(-17, 0, 34, 9); c.strokeStyle = '#7b6f50'; c.lineWidth = 1; c.strokeRect(-17, 0, 34, 9);
  c.fillStyle = '#1b2c3c'; c.beginPath(); c.moveTo(-7, -15); c.lineTo(7, -15); c.lineTo(9, -7); c.lineTo(-9, -7); c.fill();
  c.fillStyle = '#dce1d6'; c.fillRect(-3, 9, 6, 4); c.strokeStyle = '#c2c7cb'; c.beginPath(); c.moveTo(0, -20); c.lineTo(0, -29); c.lineTo(6, -32); c.stroke();
  c.restore();
  // Vector and live labels, always in screen space.
  c.fillStyle = '#e2e7ee'; c.font = '10px monospace'; c.fillText(`${fmt(state.y)} м`, sx + 36, sy - 29);
  c.fillStyle = '#98a6b9'; c.font = '9px monospace'; c.fillText(`${fmt(state.vy, 1)} м/с`, sx + 36, sy - 14);
}

let lastUI = 0;
function frame(now) {
  const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
  lastFrame = now;
  if (state.status === 'flying') {
    accumulator += elapsed;
    while (accumulator >= fixedDt && state.status === 'flying') {
      step(state, fixedDt); accumulator -= fixedDt;
      if (state.time - lastSample >= .2 || state.status !== 'flying') sample();
    }
  }
  if (now - lastUI > 80) { update(); lastUI = now; }
  drawScene();
  requestAnimationFrame(frame);
}
$('export').addEventListener('click', () => {
  const keys = ['time', 'x', 'altitude', 'vx', 'vy', 'fuel', 'throttle', 'angle', 'ax', 'ay'];
  const rows = [keys.join(','), ...history.map(row => keys.map(key => row[key].toFixed(4)).join(','))];
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'moon-telemetry.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
fillForm(); reset(); requestAnimationFrame(frame);
