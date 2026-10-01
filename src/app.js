import { PRESETS, createState, metrics, step } from './physics.js';
import { MISSION_INFO, guidance, predictContact, landingScore, advice } from './game.js';

const $ = id => document.getElementById(id);
if (window.MoonAndroid) document.body.classList.add('android-app');
const fmt = (v, digits = 1) => Number.isFinite(v) ? v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '∞';
let config = { ...PRESETS.training };
let state = createState(config);
let history = [];
let accumulator = 0;
let lastFrame = 0;
let lastSample = -1;
let mission = 'training';
let custom = false;
let mode = 'manual';
let creditMode = 'manual';
let timeScale = 1;
let cameraScale = 0;
let effectTime = 10;
let resultMarkup = '';
let soundEnabled = false;
let audio = null;
let engine = null;
let engineGain = null;
const held = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const modeNames = { manual: 'Пилот', assist: 'Помощь', auto: 'Автопилот' };
const descriptions = {
  manual: 'Вы управляете тягой и наклоном. Полные очки за посадку.',
  assist: 'Автотяга контролирует спуск. Вы управляете наклоном. Очки ×0,65.',
  auto: 'Автопилот управляет тягой и наклоном. Демонстрация без рекордов.'
};
let storageAvailable = true;
let logbook = { records: {}, flights: 0, landings: 0, recent: [] };
try {
  const saved = JSON.parse(localStorage.getItem('moon-logbook-v2') || 'null');
  if (saved && typeof saved === 'object') {
    for (const name of Object.keys(PRESETS)) for (const type of ['manual', 'assist']) {
      const value = saved.records?.[`${name}:${type}`];
      if (Number.isFinite(value) && value > 0 && value <= 5000) logbook.records[`${name}:${type}`] = Math.round(value);
    }
    for (const key of ['flights', 'landings']) if (Number.isInteger(saved[key]) && saved[key] >= 0 && saved[key] <= 1e6) logbook[key] = saved[key];
    if (Array.isArray(saved.recent)) logbook.recent = saved.recent.filter(r => r && (Object.hasOwn(MISSION_INFO, r.mission) || r.mission === 'custom') && Object.hasOwn(modeNames, r.mode) && Number.isFinite(r.score) && r.score >= 0 && r.score <= 5000 && typeof r.safe === 'boolean' && typeof r.onPad === 'boolean').slice(0, 6);
  }
} catch { storageAvailable = false; }
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
  if (audio) engineGain.gain.setTargetAtTime(0, audio.currentTime, .08);
  state = createState(config);
  history = [];
  lastSample = -1;
  accumulator = 0;
  $('throttle').value = 0;
  $('angle').value = 0;
  $('result').hidden = true;
  resultMarkup = '';
  effectTime = 10;
  cameraScale = 0;
  creditMode = 'manual';
  held.clear();
  sample();
  update();
}
function toggleFlight() {
  if (state.status === 'ready' || state.status === 'paused') { state.status = 'flying'; classify(); }
  else if (state.status === 'flying') state.status = 'paused';
  else return;
  if (audio && state.status !== 'flying') engineGain.gain.setTargetAtTime(0, audio.currentTime, .08);
  accumulator = 0;
  update();
}
function classify() {
  if (mode === 'auto') creditMode = 'auto';
  else if (mode === 'assist' && creditMode === 'manual') creditMode = 'assist';
}
function selectMission(name) {
  mission = name; custom = false;
  config = { ...PRESETS[name] };
  $('preset').value = name;
  fillForm(); reset();
}
$('start').addEventListener('click', toggleFlight);
$('launch').addEventListener('click', toggleFlight);
$('demo').addEventListener('click', () => { mode = 'auto'; toggleFlight(); });
$('reset').addEventListener('click', reset);
$('preset').addEventListener('change', e => selectMission(e.target.value));
document.querySelectorAll('[data-mission]').forEach(button => button.addEventListener('click', () => selectMission(button.dataset.mission)));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  held.clear();
  if (state.status === 'flying') classify();
  update();
}));
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {
  timeScale = Number(button.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
}));
$('config-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = new FormData(e.target);
  for (const [key, value] of data) config[key] = Number(value);
  custom = true;
  reset();
});
function controls() {
  if (['landed', 'crashed'].includes(state.status)) return;
  state.throttle = Number($('throttle').value);
  state.angle = Number($('angle').value);
  update();
}
$('throttle').addEventListener('input', controls);
$('angle').addEventListener('input', controls);
$('level').addEventListener('click', () => { $('angle').value = 0; controls(); });
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey || $('help-dialog').open) return;
  if (e.code === 'Space') {
    if (e.target.tagName === 'BUTTON' && e.target.id !== 'start') return;
    e.preventDefault(); if (!e.repeat) toggleFlight();
  }
  if (e.code === 'KeyR' && !e.repeat) { e.preventDefault(); reset(); return; }
  if (state.status === 'landed' || state.status === 'crashed') return;
  const keys = { ArrowUp: 'throttleUp', KeyW: 'throttleUp', ArrowDown: 'throttleDown', KeyS: 'throttleDown', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  if (keys[e.code]) {
    e.preventDefault();
    held.add(keys[e.code]);
  }
});
document.addEventListener('keyup', e => {
  const keys = { ArrowUp: 'throttleUp', KeyW: 'throttleUp', ArrowDown: 'throttleDown', KeyS: 'throttleDown', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  held.delete(keys[e.code]);
});
window.addEventListener('blur', () => held.clear());
document.addEventListener('visibilitychange', () => { held.clear(); if (document.hidden && state.status === 'flying') toggleFlight(); });
window.addEventListener('moon-app-pause', () => { held.clear(); if (state.status === 'flying') toggleFlight(); });
document.querySelectorAll('[data-hold]').forEach(button => {
  button.addEventListener('pointerdown', e => {
    e.preventDefault(); button.setPointerCapture(e.pointerId);
    const action = button.dataset.hold;
    if (mode === 'manual' && action.startsWith('throttle')) state.throttle = Math.max(0, Math.min(100, state.throttle + (action === 'throttleUp' ? 2 : -2)));
    if (mode !== 'auto' && !action.startsWith('throttle')) state.angle = Math.max(-60, Math.min(60, state.angle + (action === 'right' ? 2 : -2)));
    held.add(action); update();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => held.delete(button.dataset.hold));
});
function applyHeld(dt) {
  if (['landed', 'crashed'].includes(state.status)) return;
  if (mode === 'manual') state.throttle = Math.max(0, Math.min(100, state.throttle + (Number(held.has('throttleUp')) - Number(held.has('throttleDown'))) * 35 * dt));
  if (mode !== 'auto') state.angle = Math.max(-60, Math.min(60, state.angle + (Number(held.has('right')) - Number(held.has('left'))) * 45 * dt));
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
$('help').addEventListener('click', () => { if (state.status === 'flying') toggleFlight(); held.clear(); $('help-dialog').showModal(); });
for (const id of ['close-help', 'help-start']) $(id).addEventListener('click', () => $('help-dialog').close());
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.flight-panel').requestFullscreen();
  } catch { toast('Полноэкранный режим недоступен в этом браузере.'); }
});
function ensureAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) { toast('Звук не поддерживается в этом браузере.'); return false; }
  if (!audio) {
    audio = new Context(); engine = audio.createOscillator(); engineGain = audio.createGain();
    engine.type = 'sawtooth'; engine.frequency.value = 55; engineGain.gain.value = 0;
    const filter = audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220;
    engine.connect(filter); filter.connect(engineGain); engineGain.connect(audio.destination); engine.start();
  }
  audio.resume().catch(() => {});
  return true;
}
$('sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  if (soundEnabled && !ensureAudio()) soundEnabled = false;
  $('sound').textContent = soundEnabled ? 'Звук вкл.' : 'Звук выкл.';
  $('sound').setAttribute('aria-pressed', String(soundEnabled));
  $('sound').setAttribute('aria-label', soundEnabled ? 'Выключить звук' : 'Включить звук');
});
function landingSound(safe) {
  if (!soundEnabled || !audio) return;
  const now = audio.currentTime;
  const tone = audio.createOscillator(), gain = audio.createGain();
  tone.type = safe ? 'sine' : 'sawtooth';
  tone.frequency.setValueAtTime(safe ? 440 : 100, now);
  tone.frequency.exponentialRampToValueAtTime(safe ? 880 : 30, now + .5);
  gain.gain.setValueAtTime(.08, now); gain.gain.exponentialRampToValueAtTime(.001, now + .7);
  tone.connect(gain); gain.connect(audio.destination); tone.start(); tone.stop(now + .7);
}
function updateLogbook() {
  $('stat-flights').textContent = logbook.flights;
  $('stat-landings').textContent = logbook.landings;
  $('stat-best').textContent = Math.max(0, ...Object.values(logbook.records)) || '—';
  $('stat-medals').textContent = `${Object.keys(PRESETS).filter(key => logbook.records[`${key}:manual`]).length} / 5`;
  $('storage-note').hidden = storageAvailable;
  $('recent-flights').innerHTML = logbook.recent.length ? logbook.recent.map(r => `<div><span>${r.mission === 'custom' ? 'Свободный полёт' : MISSION_INFO[r.mission].name}</span><span>${modeNames[r.mode]}</span><span class="${r.safe && r.onPad ? 'success-text' : ''}">${r.safe ? r.onPad ? 'На площадке' : 'Вне цели' : 'Авария'}</span><b>${r.mode === 'auto' ? 'ДЕМО' : fmt(r.score, 0)}</b></div>`).join('') : '<p>Ваша история полётов начнётся с первой посадки.</p>';
}
function finishFlight() {
  effectTime = 0;
  held.clear();
  const o = state.outcome, score = landingScore(state, config.fuel, creditMode);
  const key = `${mission}:${creditMode}`;
  const newRecord = score.eligible && !custom && score.total > (logbook.records[key] || 0);
  if (newRecord) logbook.records[key] = score.total;
  logbook.flights++;
  if (o.safe && o.onPad) logbook.landings++;
  logbook.recent.unshift({ mission: custom ? 'custom' : mission, mode: creditMode, score: score.total, safe: o.safe, onPad: o.onPad });
  logbook.recent = logbook.recent.slice(0, 6);
  try { localStorage.setItem('moon-logbook-v2', JSON.stringify(logbook)); storageAvailable = true; } catch { storageAvailable = false; }
  updateLogbook();
  landingSound(o.safe);
  const title = o.safe ? o.onPad ? 'Мягкая посадка!' : 'Посадка вне цели' : 'Жёсткое касание';
  const reasons = [];
  if (Math.abs(o.vy) > 2) reasons.push('Слишком высокая вертикальная скорость');
  if (Math.abs(o.vx) > 1) reasons.push('Не погашена боковая скорость');
  if (Math.abs(o.angle) > 8) reasons.push('Модуль слишком сильно наклонён');
  if (!o.onPad) reasons.push('Модуль оказался за границей площадки');
  resultMarkup = `<div class="eyebrow">${creditMode === 'auto' ? 'ДЕМОНСТРАЦИЯ АВТОПИЛОТА' : custom ? 'СВОБОДНЫЙ ПОЛЁТ' : newRecord ? 'НОВЫЙ РЕКОРД МИССИИ' : 'МИССИЯ ЗАВЕРШЕНА'}</div><h3>${title}</h3><div class="result-score">${fmt(score.total, 0)}<small>${creditMode === 'auto' ? 'ОЦЕНКА · БЕЗ РЕКОРДА' : score.medal.toUpperCase() + (creditMode === 'assist' ? ' · ПОМОЩЬ ×0,65' : '')}</small></div><div class="score-breakdown"><span>Точность <b>${score.precision}</b></span><span>Мягкость <b>${score.softness}</b></span><span>Топливо <b>${score.economy}</b></span></div><p>Y: ${fmt(o.vy, 2)} м/с · X: ${fmt(o.vx, 2)} м/с · угол: ${fmt(o.angle, 1)}°</p><p>От цели: ${fmt(o.x)} м · топлива: ${fmt(state.fuel, 0)} кг</p><p class="result-reason">${reasons.length ? reasons.join('. ') + '.' : 'Экипаж в безопасности. Площадка достигнута.'}</p><div class="result-actions"><button data-result="retry" class="secondary">↻ Ещё попытка</button>${o.safe && o.onPad && mission !== 'rescue' ? '<button data-result="next" class="primary">Следующая миссия →</button>' : '<button data-result="help" class="primary">Как улучшить посадку</button>'}</div>${custom ? '<small>Свободный полёт не участвует в рекордах миссий.</small>' : ''}`;
  $('result').className = `result ${o.safe ? '' : 'crash'}`;
}
$('result').addEventListener('click', e => {
  const action = e.target.closest('[data-result]')?.dataset.result;
  if (action === 'retry') reset();
  if (action === 'next') { const ids = Object.keys(PRESETS); selectMission(ids[(ids.indexOf(mission) + 1) % ids.length]); }
  if (action === 'help') $('help-dialog').showModal();
});

function update() {
  const readout = state.outcome ? { ...state, thrust: state.outcome.thrust, flow: state.outcome.flow } : state;
  const m = metrics(readout);
  const prediction = predictContact(state);
  const tip = advice(state, mode);
  const info = MISSION_INFO[mission];
  $('launch-overlay').hidden = state.status !== 'ready';
  $('throttle').value = state.throttle;
  $('angle').value = state.angle;
  $('mission-description').textContent = custom ? 'Свободный полёт · свои параметры · без рекорда миссии' : info.text;
  $('sector-name').textContent = info.sector.toUpperCase();
  const record = logbook.records[`${mission}:${mode}`];
  $('best-score').textContent = !custom && mode !== 'auto' && record ? `${fmt(record, 0)} · ${modeNames[mode]}` : '—';
  $('pad-label').textContent = `ЗОНА ПОСАДКИ ±${config.padRadius ?? 40} М`;
  $('mode-description').textContent = descriptions[mode];
  $('control-tag').textContent = mode === 'manual' ? 'РУЧНОЙ РЕЖИМ' : mode === 'assist' ? 'АВТОТЯГА' : 'АВТОПИЛОТ';
  $('advice-text').textContent = tip.text;
  $('flight-advice').className = `flight-advice ${tip.tone}`;
  $('hud-course').textContent = Math.abs(state.x) < 2 ? 'По центру' : `${state.x > 0 ? '←' : '→'} ${fmt(Math.abs(state.x), 0)} м`;
  $('hud-impact').textContent = prediction ? `${fmt(prediction.x, 0)} м · ${fmt(prediction.time, 0)} с` : 'Касание не ожидается';
  $('hud-impact').className = prediction && Math.abs(prediction.x) > (config.padRadius ?? 40) ? 'warning-text' : '';
  $('hud-speed').textContent = `${fmt(Math.abs(state.vy), 1)} / 2 м/с`;
  $('hud-speed').className = Math.abs(state.vy) <= 2 ? 'success-text' : '';
  const checks = [
    ['check-vertical', Math.abs(state.vy) <= 2, 'Вертикальная скорость ≤ 2 м/с'],
    ['check-horizontal', Math.abs(state.vx) <= 1, 'Боковая скорость ≤ 1 м/с'],
    ['check-angle', Math.abs(state.angle) <= 8, 'Наклон ≤ 8°'],
    ['check-pad', Math.abs(state.x) <= (config.padRadius ?? 40), 'Над посадочной площадкой']
  ];
  for (const [id, passed, label] of checks) { $(id).textContent = `${passed ? '✓' : '○'} ${label}`; $(id).className = passed ? 'passed' : ''; }
  document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  document.querySelectorAll('[data-mission]').forEach(b => {
    b.classList.toggle('active', !custom && b.dataset.mission === mission);
    b.setAttribute('aria-current', String(!custom && b.dataset.mission === mission));
    const best = logbook.records[`${b.dataset.mission}:manual`];
    if (best) b.querySelector('.mission-record').textContent = `Пилот · ${fmt(best, 0)} очков`;
  });
  const values = {
    height: fmt(state.y), vy: fmt(state.vy, 2), vx: fmt(state.vx, 2), ay: fmt(state.ay, 3), fuel: fmt(state.fuel, 0),
    'throttle-value': fmt(state.throttle, 0), 'angle-value': fmt(state.angle, 0),
    'hover-label': m.hover > 100 ? 'Зависание недоступно' : `Зависание ≈ ${fmt(m.hover, 0)}%`,
    offset: `Смещение от цели: ${fmt(state.x)} м`,
    force: `${fmt(readout.thrust, 0)} Н`, mass: `${fmt(m.mass, 0)} кг`, twr: fmt(m.twr, 2),
    'delta-v': `${fmt(m.deltaV, 0)} м/с`, flow: `${fmt(readout.flow, 2)} кг/с`,
    'force-label': state.outcome ? 'Тяга F при касании' : 'Тяга F',
    'flow-label': state.outcome ? 'Расход ṁ при касании' : 'Расход ṁ',
    'telemetry-caption': state.outcome ? '/ в момент касания' : '/ в реальном времени',
    'burn-time': !state.outcome && Number.isFinite(m.burnTime) ? `${fmt(m.burnTime, 0)} с` : '—',
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
  $('throttle').disabled = terminal || mode !== 'manual';
  $('angle').disabled = terminal || mode === 'auto';
  $('level').disabled = terminal || mode === 'auto';
  document.querySelectorAll('[data-mode]').forEach(b => { b.disabled = terminal; });
  document.querySelectorAll('[data-hold]').forEach(b => { b.disabled = terminal || (b.dataset.hold.startsWith('throttle') ? mode !== 'manual' : mode === 'auto'); });
  $('start').disabled = terminal;
  $('start').textContent = state.status === 'flying' ? 'Ⅱ Пауза' : state.status === 'paused' ? '▶︎ Продолжить' : terminal ? 'Полёт завершён' : '▶︎ Начать полёт';
  if (terminal && resultMarkup && effectTime > .85 && $('result').hidden) {
    $('result').innerHTML = resultMarkup;
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
  const desiredScale = Math.min(3.4, Math.max(45, h - 180) / Math.max(state.y * 1.3 + 70, 140), Math.max(80, w - 120) / (Math.abs(state.x) + (config.padRadius ?? 40) * 2 + 90));
  cameraScale = cameraScale ? cameraScale + (desiredScale - cameraScale) * (reducedMotion ? 1 : .07) : desiredScale;
  const scale = cameraScale;
  const center = state.x * .5;
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
  const pad = screenX(0), padHalf = Math.max(2, (config.padRadius ?? 40) * scale);
  const beacon = .35 + Math.sin(state.time * 3) * .15;
  c.fillStyle = `rgba(203,247,122,${beacon * .15})`;
  c.fillRect(pad - padHalf, ground - 26, padHalf * 2, 26);
  c.strokeStyle = '#cbf77a'; c.lineWidth = 2; c.beginPath(); c.moveTo(pad - padHalf, ground); c.lineTo(pad + padHalf, ground); c.stroke();
  c.strokeStyle = '#cbf77a66'; c.lineWidth = 1;
  for (const x of [pad - padHalf, pad + padHalf]) { c.beginPath(); c.moveTo(x, ground); c.lineTo(x, ground - 14); c.stroke(); }
  c.fillStyle = '#cbf77a'; c.font = '9px monospace'; c.textAlign = 'center'; c.fillText('H', pad, ground + 17); c.textAlign = 'left';
  if (pad < 0 || pad > w) { c.fillText(pad < 0 ? '← ЦЕЛЬ' : 'ЦЕЛЬ →', pad < 0 ? 14 : w - 75, ground - 20); }
  // Actual flight trail in the same moving coordinate frame.
  c.strokeStyle = '#cbf77a33'; c.lineWidth = 1; c.setLineDash([2, 5]); c.beginPath();
  history.slice(-400).forEach((s, i) => { const x = screenX(s.x), y = ground - s.altitude * scale; if (!i) c.moveTo(x, y); else c.lineTo(x, y); }); c.stroke(); c.setLineDash([]);
  const prediction = $('show-prediction').checked && !['landed', 'crashed'].includes(state.status) ? predictContact(state) : null;
  if (prediction) {
    c.strokeStyle = '#f3b96b70'; c.lineWidth = 1; c.setLineDash([5, 6]); c.beginPath();
    for (let i = 0; i <= 35; i++) {
      const t = prediction.time * i / 35;
      const x = screenX(state.x + state.vx * t + .5 * state.ax * t * t);
      const y = ground - (state.y + state.vy * t + .5 * state.ay * t * t) * scale;
      if (!i) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke(); c.setLineDash([]);
    const px = screenX(prediction.x);
    c.strokeStyle = '#f3b96b'; c.beginPath(); c.arc(px, ground, 5, 0, Math.PI * 2); c.stroke();
  }
  c.strokeStyle = '#cbd6e51c'; c.beginPath(); c.moveTo(sx, sy + 12); c.lineTo(sx, ground); c.stroke();
  if (!reducedMotion && state.y < 45 && state.thrust > 0 && state.status === 'flying') {
    for (let i = 0; i < 22; i++) {
      const progress = (state.time * 1.4 + i * .137) % 1;
      const side = i % 2 ? 1 : -1;
      c.fillStyle = `rgba(162,157,138,${(1 - progress) * .24 * (1 - state.y / 45)})`;
      c.beginPath(); c.ellipse(sx + side * progress * 120, ground - Math.sin(progress * Math.PI) * 12, 3 + progress * 14, 1 + progress * 4, 0, 0, Math.PI * 2); c.fill();
    }
  }
  // Lander is enlarged for readability; its foot position represents altitude.
  c.save(); c.translate(sx, sy - 22); c.rotate(state.angle * Math.PI / 180);
  if (state.status === 'crashed') { c.rotate(.45); c.globalAlpha = .45; }
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
  if (!reducedMotion && effectTime < 1.8 && ['landed', 'crashed'].includes(state.status)) {
    const crash = state.status === 'crashed';
    const progress = effectTime / 1.8;
    for (let i = 0; i < (crash ? 30 : 18); i++) {
      const direction = (i * 2.39996) % Math.PI;
      const distance = progress * (35 + i % 7 * 15);
      const px = sx + Math.cos(direction) * distance * (i % 2 ? -1 : 1);
      const py = ground - Math.sin(direction) * distance * .65 + progress * progress * 25;
      c.fillStyle = crash ? `rgba(247,${120 + i % 3 * 25},68,${1 - progress})` : `rgba(190,184,160,${(1 - progress) * .6})`;
      c.beginPath(); c.arc(px, py, (1 - progress) * (crash ? 4 : 5) + 1, 0, Math.PI * 2); c.fill();
    }
    if (crash) { c.strokeStyle = `rgba(255,172,106,${1 - progress})`; c.lineWidth = 2; c.beginPath(); c.arc(sx, ground - 15, 10 + progress * 90, 0, Math.PI * 2); c.stroke(); }
  }
  if (state.status === 'flying' && Math.hypot(state.vx, state.vy) > .5) {
    const speed = Math.hypot(state.vx, state.vy), length = Math.min(55, speed * 1.8);
    const dx = state.vx / speed * length, dy = -state.vy / speed * length;
    c.strokeStyle = '#78ced0a0'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(sx, sy - 20); c.lineTo(sx + dx, sy - 20 + dy); c.stroke();
    c.save(); c.translate(sx + dx, sy - 20 + dy); c.rotate(Math.atan2(dy, dx)); c.fillStyle = '#78ced0'; c.beginPath(); c.moveTo(0, 0); c.lineTo(-6, -3); c.lineTo(-6, 3); c.fill(); c.restore();
  }
  // Vector and live labels, always in screen space.
  c.fillStyle = '#e2e7ee'; c.font = '10px monospace'; c.fillText(`${fmt(state.y)} м`, sx + 36, sy - 29);
  c.fillStyle = '#98a6b9'; c.font = '9px monospace'; c.fillText(`${fmt(state.vy, 1)} м/с`, sx + 36, sy - 14);
}

let lastUI = 0;
function frame(now) {
  const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
  lastFrame = now;
  if (!$('help-dialog').open) applyHeld(elapsed);
  if (state.status === 'flying') {
    accumulator += elapsed * timeScale;
    while (accumulator >= fixedDt && state.status === 'flying') {
      if (mode !== 'manual') {
        const control = guidance(state);
        state.throttle = mode === 'auto' ? control.throttle : control.assistThrottle;
        if (mode === 'auto') state.angle = control.angle;
      }
      step(state, fixedDt); accumulator -= fixedDt;
      if (state.time - lastSample >= .2 || state.status !== 'flying') sample();
      if (state.status !== 'flying') finishFlight();
    }
  }
  effectTime += elapsed;
  if (audio) {
    engineGain.gain.setTargetAtTime(soundEnabled && state.status === 'flying' ? .018 * state.thrust / config.maxThrust : 0, audio.currentTime, .08);
    engine.frequency.setTargetAtTime(45 + state.thrust / config.maxThrust * 65, audio.currentTime, .08);
  }
  if (now - lastUI > 80) { update(); lastUI = now; }
  drawScene();
  requestAnimationFrame(frame);
}
$('export').addEventListener('click', () => {
  const keys = ['time', 'x', 'altitude', 'vx', 'vy', 'fuel', 'throttle', 'angle', 'ax', 'ay'];
  const rows = [keys.join(','), ...history.map(row => keys.map(key => row[key].toFixed(4)).join(','))];
  if (window.MoonAndroid && typeof window.MoonAndroid.saveTelemetry === 'function') {
    window.MoonAndroid.saveTelemetry(rows.join('\n'));
    return;
  }
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'moon-telemetry.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
fillForm(); updateLogbook(); reset(); requestAnimationFrame(frame);
