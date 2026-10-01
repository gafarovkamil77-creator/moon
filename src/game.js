import { metrics } from './physics.js';

export const MISSION_INFO = {
  training: { name: 'Первый спуск', sector: 'Море Спокойствия', difficulty: 'ОБУЧЕНИЕ', text: 'Освойте тягу и мягко коснитесь широкой площадки.', number: '01' },
  approach: { name: 'Заход на посадку', sector: 'Океан Бурь', difficulty: 'СРЕДНЯЯ', text: 'Погасите боковую скорость и найдите центр площадки.', number: '02' },
  hard: { name: 'Критический запас', sector: 'Кратер Тихо', difficulty: 'СЛОЖНАЯ', text: 'Большая скорость спуска. Начните торможение заранее.', number: '03' },
  precision: { name: 'В игольное ушко', sector: 'Кратер Коперник', difficulty: 'ЭКСПЕРТ', text: 'Площадка шириной всего 24 метра. Точность решает всё.', number: '04' },
  rescue: { name: 'Последний шанс', sector: 'Южный полюс', difficulty: 'ЭКСПЕРТ', text: 'Всего 70 кг топлива. Исправьте курс и спасите экипаж.', number: '05' }
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A velocity-envelope controller: brake smoothly toward a gentle final descent.
export function guidance(s) {
  const desiredVx = clamp(-s.x * .12, -16, 16);
  const ax = clamp((desiredVx - s.vx) * .7, -1.8, 1.8);
  let desiredVy = -Math.min(24, Math.sqrt(1.3 * Math.max(0, s.y - 2)) + .65);
  if (s.y < 90 && Math.abs(s.x) > Math.max(3, (s.padRadius ?? 40) * .35)) desiredVy = -.25;
  const vertical = Math.max(.12, s.gravity + (desiredVy - s.vy) * .9);
  const angle = clamp(Math.atan2(ax, vertical) * 180 / Math.PI, -35, 35);
  const total = vertical / Math.cos(angle * Math.PI / 180);
  return {
    angle, throttle: clamp(total * (s.dryMass + s.fuel) / s.maxThrust * 100, 0, 100),
    assistThrottle: clamp(vertical / Math.cos(s.angle * Math.PI / 180) * (s.dryMass + s.fuel) / s.maxThrust * 100, 0, 100),
    targetVy: desiredVy
  };
}

// Local extrapolation with constant acceleration; deliberately not an autopilot forecast.
export function predictContact(s) {
  if (s.y <= 0) return { time: 0, x: s.x, vx: s.vx, vy: s.vy };
  let time;
  if (Math.abs(s.ay) < 1e-9) time = s.vy < 0 ? -s.y / s.vy : Infinity;
  else {
    const disc = s.vy * s.vy - 2 * s.ay * s.y;
    if (disc < 0) return null;
    const roots = [(-s.vy - Math.sqrt(disc)) / s.ay, (-s.vy + Math.sqrt(disc)) / s.ay].filter(t => t > 0);
    time = roots.length ? Math.min(...roots) : Infinity;
  }
  if (!Number.isFinite(time) || time > 120) return null;
  return { time, x: s.x + s.vx * time + .5 * s.ax * time * time, vx: s.vx + s.ax * time, vy: s.vy + s.ay * time };
}

export function landingScore(s, initialFuel, mode = 'manual') {
  const o = s.outcome;
  if (!o?.safe || !o.onPad) return { total: 0, precision: 0, softness: 0, economy: 0, medal: 'Без медали', eligible: false, multiplier: 1 };
  const precision = Math.round(1500 * clamp(1 - Math.abs(o.x) / (s.padRadius ?? 40), 0, 1));
  const softness = Math.round(1500 * clamp(1 - (Math.abs(o.vy) / 2 + Math.abs(o.vx)) / 2, 0, 1));
  const economy = Math.round(1000 * clamp(initialFuel > 0 ? s.fuel / initialFuel : 0, 0, 1));
  const multiplier = mode === 'assist' ? .65 : 1;
  const total = Math.round((1000 + precision + softness + economy) * multiplier);
  return { total, precision, softness, economy, multiplier, medal: total >= 3800 ? 'Золото' : total >= 2800 ? 'Серебро' : 'Бронза', eligible: mode !== 'auto' };
}

export function advice(s, mode) {
  if (s.status === 'ready') return { text: 'Начните полёт. Для знакомства попробуйте автопилот.', tone: 'neutral' };
  if (s.status === 'paused') return { text: 'Пауза. Можно сменить режим управления и оценить траекторию.', tone: 'neutral' };
  if (s.status === 'landed') return { text: s.outcome.onPad ? 'Экипаж в безопасности. Отличная работа!' : 'Модуль цел. В следующий раз удерживайте курс к площадке.', tone: 'safe' };
  if (s.status === 'crashed') return { text: 'Попробуйте ещё раз: тормозите раньше и выравнивайте модуль.', tone: 'danger' };
  if (s.fuel <= 0) return { text: 'Топливо закончилось. Двигатель больше не создаёт тягу.', tone: 'danger' };
  const m = metrics(s);
  if (s.vy < -2 && s.y < m.stopping * 1.3) return { text: 'Опасный спуск! Полная тяга, минимальный наклон.', tone: 'danger' };
  if (mode === 'auto') return { text: 'Автопилот ведёт к центру площадки. Переключитесь на ручной режим в любой момент.', tone: 'safe' };
  if (s.y < 30 && (Math.abs(s.vx) > 1 || Math.abs(s.angle) > 8)) return { text: 'Перед касанием: боковая скорость ≤ 1 м/с, наклон ≤ 8°.', tone: 'warn' };
  if (Math.abs(s.vx) > 3) return { text: `Гасите боковую скорость: наклоните модуль ${s.vx > 0 ? 'влево' : 'вправо'}.`, tone: 'warn' };
  if (s.vy > 3) return { text: 'Вы набираете высоту. Уменьшите тягу для продолжения спуска.', tone: 'warn' };
  if (s.y < 60) return { text: 'Финальный спуск. Держите скорость около −1 м/с и выровняйте модуль.', tone: 'safe' };
  return { text: 'Следите за запасом высоты над тормозным путём. Оставляйте время на выравнивание.', tone: 'neutral' };
}
