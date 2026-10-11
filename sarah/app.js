/* =========================================================
   Glow — personal calorie & meal app
   Pure vanilla JS, offline-first, all data stays on the phone.
   ========================================================= */
'use strict';

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r5 = n => Math.round(n / 5) * 5;
const r1 = n => Math.round(n * 10) / 10;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uid = () => Math.random().toString(36).slice(2, 9);
const buzz = (ms = 10) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const isHe = s => /[֐-׿]/.test(s);
const fmtEN = (d, o = { month: 'short', day: 'numeric' }) => d.toLocaleDateString('en-US', o);
const fmtHE = (d, o = { month: 'long', day: 'numeric' }) => d.toLocaleDateString('he-IL', o);
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

// ---------- state ----------
const STORE_KEY = 'glow:' + CONFIG.id;
const DEFAULT_TIMES = { breakfast: '08:00', snack1: '10:30', lunch: '13:30', snack2: '16:30', dinner: '19:30' };

function defaultState() {
  return {
    v: 1,
    profile: {
      name: CONFIG.name, nameHe: CONFIG.nameHe, heightCm: CONFIG.heightCm, age: CONFIG.age,
      startWeight: CONFIG.startWeight, goalWeight: CONFIG.goalWeight, activity: 1.375, pace: 'gentle', startDate: todayKey(),
    },
    settings: { theme: CONFIG.theme, waterGoal: 8, notify: false, times: { ...DEFAULT_TIMES } },
    days: {},
    weights: [{ date: todayKey(), kg: CONFIG.startWeight }],
    favorites: [],
    badges: {},
    chat: [],
  };
}

let S;
try { S = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { S = null; }
if (!S || !S.profile) S = defaultState();
S.settings.times = { ...DEFAULT_TIMES, ...S.settings.times };
S.favorites = S.favorites || [];
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('⚠️ Could not save — storage full?'); } };

const ui = { prev: {}, tab: 'home', calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), mf: { pool: 'all', tag: null, q: '' } };

// ---------- nutrition math ----------
const P = () => S.profile;
const currentWeight = () => S.weights.length ? S.weights[S.weights.length - 1].kg : P().startWeight;
const bmr = w => 10 * w + 6.25 * P().heightCm - 5 * P().age - 161; // Mifflin-St Jeor (female)
const tdee = () => Math.round(bmr(currentWeight()) * P().activity);
const FLOOR = () => (P().age < 19 ? 1500 : 1400); // never plan below this — no starving
const PACES = { gentle: 300, steady: 400, faster: 500 };
const target = () => Math.max(FLOOR(), r5(tdee() - PACES[P().pace || 'gentle']));
const proteinTarget = () => Math.round(currentWeight() * 1.5);
const minHealthyWeight = () => r1(18.5 * (P().heightCm / 100) ** 2);
const bmi = w => r1(w / (P().heightCm / 100) ** 2);
const slotTarget = slot => target() * SLOTS.find(s => s.id === slot).share;

const mealById = id => MEALS.find(m => m.id === id);
function mealCalc(meal, portion = 1, addons = []) {
  let kcal = 0, p = 0;
  meal.items.forEach(i => { kcal += i[2] * portion; p += i[3] * portion; });
  addons.forEach(ix => { const a = meal.addons[ix]; if (a) { kcal += a[1]; p += a[2]; } });
  return { kcal: r5(kcal), p: Math.round(p) };
}
const baseKcal = m => m.items.reduce((s, i) => s + i[2], 0);
const autoPortion = (meal, slot) => clamp(Math.round((slotTarget(slot) / baseKcal(meal)) * 4) / 4, 0.75, 1.5);

// ---------- days ----------
function getDay(k = todayKey()) {
  if (!S.days[k]) S.days[k] = { entries: [], water: 0, exercise: [], mood: null };
  const d = S.days[k];
  d.exercise = d.exercise || [];
  return d;
}
function ensurePlan(k = todayKey()) {
  const d = getDay(k);
  if (!d.plan) { d.plan = generatePlan(k); save(); }
  return d.plan;
}
function generatePlan(k, keep = {}) {
  const rand = rng(k + CONFIG.id + (keep._salt || ''));
  const yest = S.days[keyOf(addDays(parseKey(k), -1))]?.plan || {};
  const used = new Set();
  const plan = {};
  for (const s of SLOTS) {
    if (keep[s.id]) { plan[s.id] = keep[s.id]; used.add(keep[s.id].id); continue; }
    let pool = MEALS.filter(m => m.pools.includes(s.pool) && !used.has(m.id) && yest[s.id]?.id !== m.id);
    // prefer meals whose normal portion already fits this slot's budget
    const fits = pool.filter(m => { const r = baseKcal(m) / slotTarget(s.id); return r > 0.75 && r < 1.3; });
    if (fits.length >= 4) pool = fits;
    const weights = pool.map(m => (S.favorites.includes(m.id) ? 3 : 1));
    let r = rand() * weights.reduce((a, b) => a + b, 0), pick = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
    used.add(pick.id);
    plan[s.id] = { id: pick.id, portion: autoPortion(pick, s.id), addons: [] };
  }
  return plan;
}
const dayTotals = k => {
  const d = S.days[k];
  if (!d) return { kcal: 0, p: 0, burn: 0, n: 0 };
  return {
    kcal: d.entries.reduce((s, e) => s + e.kcal, 0),
    p: d.entries.reduce((s, e) => s + (e.p || 0), 0),
    burn: (d.exercise || []).reduce((s, e) => s + e.kcal, 0),
    n: d.entries.length,
  };
};
function dayStatus(k) {
  const t = dayTotals(k);
  if (!t.n) return null;
  const goal = target() + t.burn;
  if (k < todayKey() && t.kcal < FLOOR() * 0.8) return 'low';
  if (t.kcal <= goal + 100) return 'good';
  return 'over';
}
function streak() {
  let n = 0, d = new Date();
  if (!dayTotals(keyOf(d)).n) d = addDays(d, -1);
  while (dayTotals(keyOf(d)).n) { n++; d = addDays(d, -1); }
  return n;
}
const planEntry = (k, slot) => getDay(k).entries.find(e => e.planSlot === slot);
function slotByTime() {
  const t = nowMin(), T = S.settings.times;
  const order = SLOTS.map(s => [s.id, toMin(T[s.id])]);
  let best = order[0][0];
  for (let i = 0; i < order.length; i++) {
    const mid = i < order.length - 1 ? (order[i][1] + order[i + 1][1]) / 2 : 9999;
    if (t < mid) { best = order[i][0]; break; }
  }
  return best;
}

// ---------- projection ----------
function projection() {
  const cw = currentWeight(), goal = P().goalWeight, toLose = r1(cw - goal);
  if (toLose <= 0) return { reached: true };
  let rate = 0, source = 'plan';
  // 1. real weight trend (needs ≥3 weigh-ins over ≥10 days)
  const recent = S.weights.filter(w => daysBetween(w.date, todayKey()) <= 42);
  if (recent.length >= 3 && daysBetween(recent[0].date, recent[recent.length - 1].date) >= 10) {
    const xs = recent.map(w => daysBetween(recent[0].date, w.date)), ys = recent.map(w => w.kg);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    if (slope < -0.005) { rate = -slope * 7; source = 'trend'; }
  }
  // 2. what she's actually been eating (last 14 days)
  if (!rate) {
    const logged = [];
    for (let i = 1; i <= 14; i++) { const k = keyOf(addDays(new Date(), -i)); const t = dayTotals(k); if (t.n >= 2) logged.push(t); }
    if (logged.length >= 3) {
      const avg = logged.reduce((s, t) => s + t.kcal - t.burn, 0) / logged.length;
      const def = tdee() - avg;
      if (def > 60) { rate = (def * 7) / 7700; source = 'log'; }
    }
  }
  // 3. the plan itself
  if (!rate) rate = ((tdee() - target()) * 7) / 7700;
  rate = clamp(rate, 0.1, 1);
  const weeks = toLose / rate;
  const date = addDays(new Date(), Math.round(weeks * 7));
  return { reached: false, toLose, rate: Math.round(rate * 100) / 100, weeks, date, source };
}
function projectionText() {
  const pr = projection(), g = P().goalWeight;
  if (pr.reached) return [`You reached ${g} kg! 🏆 Time to maintain the glow.`, `הגעת ל־${g} ק״ג! 🏆 עכשיו שומרות על זה.`];
  const w = Math.round(pr.weeks);
  const enT = pr.weeks < 2 ? `${Math.round(pr.weeks * 7)} days` : `${w} weeks`;
  const heT = pr.weeks < 2 ? `${Math.round(pr.weeks * 7)} ימים` : `${w} שבועות`;
  return [
    `At this pace you’ll hit ${g} kg in ~${enT} — around ${fmtEN(pr.date)}.`,
    `בקצב הזה תגיעי ל־${g} ק״ג בעוד כ־${heT}, בסביבות ${fmtHE(pr.date)}.`,
  ];
}

// ---------- bilingual rotator ----------
function rot(en, he, cls = '') {
  return `<span class="rot ${cls}" data-en="${esc(en)}" data-he="${esc(he)}" data-cur="en" dir="ltr">${esc(en)}</span>`;
}
setInterval(() => {
  $$('.rot').forEach(el => {
    el.classList.add('out');
    setTimeout(() => {
      const next = el.dataset.cur === 'en' ? 'he' : 'en';
      el.dataset.cur = next;
      el.textContent = el.dataset[next];
      el.dir = next === 'he' ? 'rtl' : 'ltr';
      el.classList.remove('out');
    }, 550);
  });
}, 5000);

// ---------- greeting ----------
function timeOfDay() { const h = new Date().getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night'; }
const TOD_EMOJI = { morning: '☀️', afternoon: '🌤️', evening: '🌙', night: '✨' };
function greeting(seed = 0) {
  const list = GREETINGS[timeOfDay()];
  const g = list[(new Date().getDate() + seed) % list.length];
  return [g[0].replace('{n}', P().name), g[1].replace('{h}', P().nameHe)];
}

function showSplash() {
  const sp = $('#splash');
  const opens = (S.opens = (S.opens || 0) + 1); save();
  const [en, he] = greeting(opens);
  const heFirst = opens % 2 === 0;
  const q = QUOTES[opens % QUOTES.length];
  sp.innerHTML = `
    <div class="s-emoji">${TOD_EMOJI[timeOfDay()]}</div>
    <div class="s-hi" dir="${heFirst ? 'rtl' : 'ltr'}">${esc(heFirst ? he : en)}</div>
    <div class="s-hi2" dir="${heFirst ? 'ltr' : 'rtl'}">${esc(heFirst ? en : he)}</div>
    <div class="s-q" dir="${q[0] === 'he' ? 'rtl' : 'ltr'}">“${esc(q[1])}”</div>
    <div class="s-tap">tap to start ✨</div>`;
  sp.classList.remove('hide'); sp.style.display = 'flex';
  const close = () => { sp.classList.add('hide'); setTimeout(() => (sp.style.display = 'none'), 700); };
  sp.onclick = close;
  setTimeout(close, 3200);
}

// ---------- toast / confetti ----------
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function confetti(n = 120) {
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const cs = getComputedStyle(document.documentElement);
  const colors = [cs.getPropertyValue('--a1'), cs.getPropertyValue('--a2'), '#fff', '#fde68a', '#86efac'];
  const ps = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4,
    s: Math.random() * 7 + 4, c: colors[(Math.random() * colors.length) | 0], r: Math.random() * 6, vr: (Math.random() - .5) * .3,
  }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (++f < 160) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

// ---------- badges ----------
function award(id) {
  if (S.badges[id]) return;
  S.badges[id] = todayKey(); save();
  const b = BADGES.find(b => b.id === id);
  setTimeout(() => { toast(`${b.emoji} Badge unlocked: ${b.name} · ${b.he}`); confetti(90); buzz([20, 40, 20]); }, 400);
}
function checkBadges() {
  const k = todayKey(), d = getDay(k), t = dayTotals(k);
  const anyEntries = Object.values(S.days).some(d => d.entries.length);
  if (anyEntries) award('first_log');
  const st = streak();
  if (st >= 3) award('streak3'); if (st >= 7) award('streak7'); if (st >= 30) award('streak30');
  if (d.water >= S.settings.waterGoal) award('water');
  if (d.plan && SLOTS.every(s => planEntry(k, s.id))) { award('all_meals'); if (t.kcal <= target() + t.burn + 100) award('full_day'); }
  if (S.weights.length >= 2) award('weigh1');
  const lost = P().startWeight - currentWeight();
  if (lost >= 1) award('kg1'); if (lost >= 3) award('kg3');
  if (lost >= (P().startWeight - P().goalWeight) / 2 && lost > 0) award('halfway');
  if (currentWeight() <= P().goalWeight) award('goal');
  if (Object.values(S.days).some(d => (d.exercise || []).length)) award('mover');
  if (S.chat.some(m => m.me)) award('chatter');
}

// =========================================================
//  VIEWS
// =========================================================
function render() {
  document.documentElement.dataset.theme = S.settings.theme;
  $$('.nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const app = $('#app'), anim = ui.lastTab !== ui.tab; ui.lastTab = ui.tab;
  app.innerHTML = `<div class="view ${anim ? 'anim' : ''}">${VIEWS[ui.tab]()}</div>${ui.tab !== 'coach' ? '<button class="coach-fab" data-tab="coach" aria-label="Coach">💬</button>' : ''}`;
  if (ui.tab === 'coach') mountCoach();
  const go = () => {
    $$('[data-w]').forEach(el => { el.style.width = el.dataset.w; ui.prev[el.dataset.key] = el.dataset.w; });
    $$('[data-off]').forEach(el => { el.style.strokeDashoffset = el.dataset.off; ui.prev[el.dataset.key] = el.dataset.off; });
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
}

const VIEWS = {
  // ---------------- HOME ----------------
  home() {
    const k = todayKey(), d = getDay(k), plan = ensurePlan(k), t = dayTotals(k);
    const tgt = target(), budget = tgt + t.burn, left = budget - t.kcal;
    const pct = clamp(t.kcal / budget, 0, 1), C = 2 * Math.PI * 62;
    const [gEn, gHe] = greeting(-new Date().getDate()); // first variant always has her name
    const qi = Math.floor(Date.now() / 3600000) % (QUOTES.length / 2), qEn = QUOTES[qi * 2][1], qHe = QUOTES[qi * 2 + 1][1];
    const [pEn, pHe] = projectionText();
    const st = streak();
    const dayNum = daysBetween(P().startDate, k) + 1;
    const now = nowMin();
    const nextSlot = SLOTS.find(s => !planEntry(k, s.id) && toMin(S.settings.times[s.id]) >= now - 60)?.id;
    const extras = d.entries.filter(e => !e.planSlot);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

    return `
      <div class="topbar">
        <div class="row"><div class="avatar">${esc(P().name[0])}</div>
          <div><div class="small muted">${fmtEN(new Date(), { weekday: 'long' })}</div><div style="font-weight:600">${fmtEN(new Date(), { month: 'long', day: 'numeric' })}</div></div></div>
        <button class="icon-btn" data-action="settings" aria-label="Settings">⚙️</button>
      </div>

      <div class="card hero">
        <div class="rotator greet">${rot(gEn, gHe)} <span class="wave">👋</span></div>
        <div class="quote rotator">${rot('“' + qEn + '”', '“' + qHe + '”')}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="streak-pill">🔥 ${st} day streak</span>
          <span class="streak-pill">🌱 Day ${dayNum}</span>
        </div>
      </div>

      ${!standalone ? `<div class="card install-card"><div class="row"><div style="font-size:30px">📲</div><div class="grow">
        <div style="font-weight:600">Add me to your home screen</div>
        <div class="small muted">${/iPhone|iPad/.test(navigator.userAgent) ? 'Tap <b>Share</b> ⬆️ then <b>Add to Home Screen</b>' : 'Tap the browser menu ⋮ then <b>Install app</b>'}</div></div>
        ${deferredInstall ? '<button class="btn sm primary" data-action="install">Install</button>' : ''}</div></div>` : ''}

      <div class="card">
        <div class="ring-wrap">
          <div class="ring">
            <svg viewBox="0 0 150 150"><circle class="track" cx="75" cy="75" r="62" fill="none" stroke-width="13"/>
              <circle class="bar ${left < 0 ? 'over' : ''}" cx="75" cy="75" r="62" fill="none" stroke-width="13" stroke-dasharray="${C}" stroke-dashoffset="${ui.prev.ring ?? C}" data-key="ring" data-off="${C * (1 - pct)}"/></svg>
            <div class="center"><div class="big">${Math.abs(left)}</div><div class="lbl">${left >= 0 ? 'kcal left' : 'kcal over'}</div></div>
          </div>
          <div class="ring-stats">
            <div class="stat"><div class="k">🍽️ Eaten</div><div class="v">${t.kcal}</div></div>
            <div class="stat"><div class="k">🔥 Burned</div><div class="v">${t.burn}</div></div>
            <div class="stat"><div class="k">🎯 Goal</div><div class="v">${tgt}</div></div>
          </div>
        </div>
        <div style="margin-top:14px">
          <div class="row between small"><span>💪 Protein</span><span class="muted">${t.p} / ${proteinTarget()} g</span></div>
          <div class="bar-mini"><i style="width:${ui.prev.prot ?? 0}" data-key="prot" data-w="${clamp((t.p / proteinTarget()) * 100, 0, 100)}%"></i></div>
        </div>
        ${left < -200 ? `<div class="small" style="margin-top:12px;color:var(--warn)">A bit over today — totally fine. Tomorrow is a fresh page 💛</div>` : ''}
      </div>

      <div class="card" data-action="go" data-tab="progress">
        <h3>⏳ Your timeline <span class="tiny faint">${P().goalWeight} kg goal</span></h3>
        <div class="rotator" style="font-size:16px;line-height:1.45;font-weight:500">${rot(pEn, pHe)}</div>
      </div>

      <div class="card">
        <h3>Today’s plan <button class="chip" data-action="reroll-day">🎲 New menu</button></h3>
        ${SLOTS.map(s => {
          const pl = plan[s.id], m = mealById(pl.id), done = planEntry(k, s.id);
          const c = done ? { kcal: done.kcal } : mealCalc(m, pl.portion, pl.addons);
          return `<div class="meal-card ${done ? 'done' : ''} ${s.id === nextSlot ? 'next' : ''}" data-action="open-meal" data-slot="${s.id}">
            <div class="meal-emoji">${done && done.mealId !== m.id ? done.emoji : m.emoji}</div>
            <div class="meal-info">
              <div class="meal-slot">${s.emoji} ${s.en} · ${S.settings.times[s.id]} ${s.id === nextSlot ? '<span class="tag" style="background:var(--a1);color:#fff">next</span>' : ''}</div>
              <div class="meal-name he">${esc(done && done.mealId !== m.id ? done.name : m.name)}</div>
              <div class="meal-kcal">${c.kcal} kcal${pl.portion !== 1 && !done ? ` · ×${pl.portion}` : ''}</div>
            </div>
            ${done ? '' : `<button class="swap" data-action="swap" data-slot="${s.id}" aria-label="Swap">🔄</button>`}
            <button class="check ${done ? 'on' : ''}" data-action="toggle-eaten" data-slot="${s.id}" aria-label="Eaten">${done ? '✓' : ''}</button>
          </div>`;
        }).join('')}
        ${extras.length ? `<div class="divider"></div><div class="small muted" style="margin-bottom:4px">Also logged</div>
          ${extras.map(e => entryRow(e, k)).join('')}` : ''}
        <button class="btn block" style="margin-top:6px" data-action="quick-add">＋ Log something else</button>
      </div>

      <div class="card">
        <h3>💧 Water <span class="tiny faint">${d.water}/${S.settings.waterGoal} cups</span></h3>
        <div class="water" style="grid-template-columns:repeat(${Math.min(S.settings.waterGoal, 8)},1fr)">${Array.from({ length: S.settings.waterGoal }, (_, i) =>
          `<button class="drop ${i < d.water ? 'full' : ''}" data-action="water" data-i="${i}">${i < d.water ? '💧' : ''}</button>`).join('')}</div>
      </div>

      <div class="card">
        <h3>🏃‍♀️ Movement <button class="chip" data-action="add-exercise">＋ Add</button></h3>
        ${d.exercise.length ? d.exercise.map(x => `<div class="entry"><span class="e">${x.emoji}</span><div class="grow"><div class="he" style="text-align:left">${esc(x.name)}</div><div class="tiny muted">${x.min} min</div></div><span class="muted small">−${x.kcal}</span><button class="x" data-action="del-ex" data-id="${x.id}">×</button></div>`).join('')
          : `<div class="small muted">A 30-min walk ≈ 120 kcal of extra food you can enjoy 🙂</div>`}
      </div>

      <div class="card">
        <h3>How do you feel today?</h3>
        <div class="row between">${['😫', '😕', '🙂', '😊', '🤩'].map(m =>
          `<button class="mood ${d.mood === m ? 'on' : ''}" data-action="mood" data-m="${m}">${m}</button>`).join('')}</div>
      </div>`;
  },

  // ---------------- MEALS ----------------
  meals() {
    const f = ui.mf;
    const pools = [['all', 'All', '✨'], ['breakfast', 'Breakfast', '🌅'], ['lunch', 'Lunch', '☀️'], ['dinner', 'Dinner', '🌙'], ['snack', 'Snacks', '🍓']];
    const tags = ['❤️', 'צמחוני', 'חלבי', 'בשרי', 'דגים', 'מהיר', 'בלי בישול', 'מתוק', 'פינוק', 'חלבון', 'חם', 'אהוב'];
    return `
      <div class="topbar"><div><h1>Meal ideas</h1><div class="small muted he" style="text-align:left">${MEALS.length} ארוחות ישראליות, כולן בתקציב שלך</div></div>
        <button class="icon-btn" data-action="settings">⚙️</button></div>
      <div class="card" style="padding:14px">
        <div class="small muted" style="margin-bottom:8px">Your daily ${target()} kcal, split so you’re never starving:</div>
        <div class="row between small">${SLOTS.map(s => `<div class="center"><div style="font-size:20px">${s.emoji}</div><div style="font-weight:600">${r5(slotTarget(s.id))}</div><div class="tiny faint">${s.en}</div></div>`).join('')}</div>
      </div>
      <input class="input he" style="margin-bottom:10px;text-align:right" placeholder="🔎 חיפוש: עוף, טונה, שקשוקה..." value="${esc(f.q)}" data-input="meal-search">
      <div class="chips" style="margin-bottom:8px">${pools.map(p => `<button class="chip ${f.pool === p[0] ? 'on' : ''}" data-action="mf-pool" data-v="${p[0]}">${p[2]} ${p[1]}</button>`).join('')}</div>
      <div class="chips he" style="margin-bottom:14px">${tags.map(t => `<button class="chip ${f.tag === t ? 'on' : ''}" data-action="mf-tag" data-v="${t}">${t}</button>`).join('')}</div>
      <div class="meal-grid" id="mealList">${mealListHtml()}</div>`;
  },

  // ---------------- CALENDAR ----------------
  calendar() {
    const m = ui.calMonth, y = m.getFullYear(), mo = m.getMonth();
    const first = new Date(y, mo, 1), daysIn = new Date(y, mo + 1, 0).getDate(), tk = todayKey();
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push('<div class="cal-day empty"></div>');
    let logged = 0, good = 0, sum = 0;
    for (let d = 1; d <= daysIn; d++) {
      const k = keyOf(new Date(y, mo, d)), st = dayStatus(k), t = dayTotals(k);
      const w = S.weights.find(x => x.date === k), dd = S.days[k];
      if (t.n) { logged++; sum += t.kcal; if (st === 'good') good++; }
      cells.push(`<button class="cal-day ${st || ''} ${k === tk ? 'today' : ''} ${k > tk ? 'future' : ''}" data-action="open-day" data-k="${k}">
        ${dd?.mood ? `<span class="cal-mood">${dd.mood}</span>` : ''}${d}
        <span class="dots">${w ? '<i style="background:var(--a1)"></i>' : ''}${dd?.exercise?.length ? '<i style="background:#60a5fa"></i>' : ''}${dd && dd.water >= S.settings.waterGoal ? '<i style="background:#67e8f9"></i>' : ''}</span></button>`);
    }
    const mw = S.weights.filter(w => w.date.startsWith(`${y}-${pad(mo + 1)}`));
    const wChange = mw.length >= 2 ? r1(mw[mw.length - 1].kg - mw[0].kg) : null;
    return `
      <div class="topbar"><h1>Calendar</h1><button class="icon-btn" data-action="settings">⚙️</button></div>
      <div class="card">
        <div class="cal-head">
          <button class="icon-btn" data-action="cal-prev">‹</button>
          <div class="center"><div class="m">${m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div><div class="small faint he">${m.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</div></div>
          <button class="icon-btn" data-action="cal-next">›</button>
        </div>
        <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="cal-dow">${x}</div>`).join('')}${cells.join('')}</div>
        <div class="legend"><span><i style="background:var(--good)"></i>On target</span><span><i style="background:var(--warn)"></i>Over</span><span><i style="background:#60a5fa"></i>Ate too little</span><span>● weigh-in / workout / water</span></div>
      </div>
      <div class="grid3">
        <div class="card center"><div class="big-num grad-text" style="font-size:30px">${logged}</div><div class="tiny muted">days logged</div></div>
        <div class="card center"><div class="big-num grad-text" style="font-size:30px">${good}</div><div class="tiny muted">on target</div></div>
        <div class="card center"><div class="big-num grad-text" style="font-size:30px">${logged ? Math.round(sum / logged) : '—'}</div><div class="tiny muted">avg kcal</div></div>
      </div>
      ${wChange !== null ? `<div class="card center"><div class="small muted">Weight change this month</div><div class="big-num" style="color:${wChange <= 0 ? 'var(--good)' : 'var(--warn)'}">${wChange > 0 ? '+' : ''}${wChange} kg</div></div>` : ''}
      <div class="small faint center">Tap any day to see or edit what you ate</div>`;
  },

  // ---------------- PROGRESS ----------------
  progress() {
    const cw = currentWeight(), sw = P().startWeight, gw = P().goalWeight;
    const lost = r1(sw - cw), total = r1(sw - gw), pct = clamp((lost / total) * 100, 0, 100);
    const [pEn, pHe] = projectionText();
    const pr = projection();
    const srcTxt = { trend: 'based on your weigh-ins', log: 'based on what you’ve logged', plan: 'based on your plan — log weigh-ins to sharpen it' }[pr.source] || '';
    return `
      <div class="topbar"><h1>Progress</h1><button class="icon-btn" data-action="settings">⚙️</button></div>
      <div class="card">
        <div class="row between">
          <div><div class="small muted">Now</div><div class="big-num">${cw}<span style="font-size:18px" class="muted"> kg</span></div></div>
          <div class="center"><div class="small muted">Lost</div><div class="big-num grad-text">${lost > 0 ? '−' + lost : lost === 0 ? '0' : '+' + Math.abs(lost)}</div></div>
          <div style="text-align:right"><div class="small muted">Goal</div><div class="big-num">${gw}</div></div>
        </div>
        <div class="progress-track" style="margin-top:16px"><i style="width:${ui.prev.prog ?? 0}" data-key="prog" data-w="${pct}%"></i></div>
        <div class="row between tiny faint" style="margin-top:6px"><span>${sw} kg start</span><span>${Math.round(pct)}%</span><span>${r1(Math.max(0, cw - gw))} kg to go</span></div>
        <button class="btn primary block" style="margin-top:16px" data-action="log-weight">⚖️ Log today’s weight</button>
      </div>
      <div class="card">
        <h3>⏳ When will I get there?</h3>
        <div class="rotator" style="font-size:18px;font-weight:600;line-height:1.4">${rot(pEn, pHe)}</div>
        ${!pr.reached ? `<div class="small muted" style="margin-top:8px">Pace: ~${pr.rate} kg/week · ${srcTxt}</div>` : ''}
      </div>
      <div class="card chart"><h3>Weight journey</h3>${weightChart()}</div>
      <div class="card chart"><h3>Last 7 days</h3>${weekBars()}</div>
      <div class="grid2">
        <div class="card"><div class="tiny muted">DAILY GOAL</div><div style="font-size:22px;font-weight:700">${target()} <span class="small muted">kcal</span></div><div class="tiny faint">Burn ≈ ${tdee()} kcal/day</div></div>
        <div class="card"><div class="tiny muted">BMI</div><div style="font-size:22px;font-weight:700">${bmi(cw)}</div><div class="tiny faint">healthy range 18.5–25</div></div>
      </div>
      <div class="card"><h3>Badges <span class="tiny faint">${Object.keys(S.badges).length}/${BADGES.length}</span></h3>
        <div class="badges">${BADGES.map(b => `<div class="badge ${S.badges[b.id] ? 'got' : ''}" title="${esc(b.desc)}"><span class="be">${b.emoji}</span><div class="bn">${b.name}</div></div>`).join('')}</div>
      </div>
      ${S.weights.length > 1 ? `<div class="card"><h3>Weigh-ins</h3>${S.weights.slice().reverse().slice(0, 12).map(w => `<div class="entry"><span class="grow">${fmtEN(parseKey(w.date), { weekday: 'short', month: 'short', day: 'numeric' })}</span><b>${w.kg} kg</b><button class="x" data-action="del-weight" data-k="${w.date}">×</button></div>`).join('')}</div>` : ''}`;
  },

  // ---------------- COACH ----------------
  coach() {
    return `
      <div class="topbar"><div class="row"><div class="avatar" style="font-size:22px">🤖</div><div><h1 style="font-size:22px">Glow Coach</h1><div class="tiny muted">Quick answers · works offline</div></div></div>
        <button class="icon-btn" data-tab="home">✕</button></div>
      <div class="chat" id="chat"></div>
      <div class="chips" id="sugg" style="margin:8px 0"></div>
      <form class="chat-input" id="chatForm"><input id="chatIn" placeholder="Ask me anything… / שאלי אותי…" autocomplete="off"><button class="btn sm primary" type="submit">Send</button></form>`;
  },
};

function mealListHtml() {
  const f = ui.mf;
  const list = MEALS.filter(m => (f.pool === 'all' || m.pools.includes(f.pool))
    && (!f.tag || (f.tag === '❤️' ? S.favorites.includes(m.id) : m.tags.includes(f.tag)))
    && (!f.q || m.name.includes(f.q) || m.items.some(i => i[0].includes(f.q)) || m.tags.some(t => t.includes(f.q))));
  return list.map(m => { const c = mealCalc(m); return `
    <button class="meal-tile" data-action="view-meal" data-id="${m.id}">
      ${S.favorites.includes(m.id) ? '<span class="fav">❤️</span>' : ''}
      <div class="mt-emoji">${m.emoji}</div>
      <div class="mt-name he">${esc(m.name)}</div>
      <div class="tiny muted">${c.kcal} kcal · ${c.p}g protein · ${m.min}′</div>
    </button>`; }).join('') || '<div class="empty-state" style="grid-column:1/-1"><span class="ee">🤷‍♀️</span>No meals match — try another filter</div>';
}

function entryRow(e, k) {
  return `<div class="entry"><span class="e">${e.emoji || '🍽️'}</span>
    <div class="grow"><div class="he" style="text-align:left;font-weight:500">${esc(e.name)}</div>
    <div class="tiny muted">${SLOTS.find(s => s.id === e.slot)?.en || ''}${e.qty && e.qty !== 1 ? ` · ×${e.qty}` : ''}${e.p ? ` · ${e.p}g protein` : ''}</div></div>
    <span class="small">${e.kcal}</span><button class="x" data-action="del-entry" data-k="${k}" data-id="${e.id}">×</button></div>`;
}

// ---------- charts (hand-rolled SVG) ----------
function weightChart() {
  const ws = S.weights; if (!ws.length) return '';
  const W = 340, H = 190, pl = 34, pr = 12, pt = 14, pb = 26;
  const pj = projection();
  const startK = ws[0].date, lastK = ws[ws.length - 1].date;
  let endK = keyOf(addDays(parseKey(lastK), 14));
  if (!pj.reached) { const pk = keyOf(pj.date); const cap = keyOf(addDays(parseKey(lastK), 150)); endK = pk < cap ? (pk > endK ? pk : endK) : cap; }
  const span = Math.max(1, daysBetween(startK, endK));
  const kgs = ws.map(w => w.kg).concat([P().goalWeight]);
  const lo = Math.floor(Math.min(...kgs) - 0.5), hi = Math.ceil(Math.max(...kgs) + 0.5);
  const X = k => pl + (daysBetween(startK, k) / span) * (W - pl - pr);
  const Y = kg => pt + ((hi - kg) / (hi - lo)) * (H - pt - pb);
  const pts = ws.map(w => `${X(w.date).toFixed(1)},${Y(w.kg).toFixed(1)}`);
  const grid = [];
  for (let v = lo; v <= hi; v += Math.max(1, Math.round((hi - lo) / 4))) grid.push(`<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="rgba(255,255,255,.4)">${v}</text>`);
  let proj = '';
  if (!pj.reached) {
    const pk = keyOf(pj.date), lw = ws[ws.length - 1];
    const ex = pk <= endK ? pk : endK, frac = daysBetween(lastK, ex) / Math.max(1, daysBetween(lastK, pk));
    const ey = lw.kg - (lw.kg - P().goalWeight) * frac;
    proj = `<line x1="${X(lastK)}" y1="${Y(lw.kg)}" x2="${X(ex)}" y2="${Y(ey)}" stroke="var(--a2)" stroke-width="2" stroke-dasharray="4 5" opacity=".8"/>
      ${pk <= endK ? `<circle cx="${X(pk)}" cy="${Y(P().goalWeight)}" r="5" fill="var(--a2)"/><text x="${X(pk) - 8}" y="${Y(P().goalWeight) - 9}" font-size="10" text-anchor="end" fill="var(--a2)">${fmtEN(pj.date)}</text>` : ''}`;
  }
  const area = ws.length > 1 ? `<path d="M${pts[0]} L${pts.join(' L')} L${X(lastK)},${H - pb} L${X(startK)},${H - pb}Z" fill="url(#wArea)"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="wArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--a1)" stop-opacity=".35"/><stop offset="1" stop-color="var(--a1)" stop-opacity="0"/></linearGradient></defs>
    ${grid.join('')}
    <line x1="${pl}" x2="${W - pr}" y1="${Y(P().goalWeight)}" y2="${Y(P().goalWeight)}" stroke="var(--good)" stroke-dasharray="2 4" opacity=".7"/>
    <text x="${pl + 4}" y="${Y(P().goalWeight) + 14}" font-size="10" fill="var(--good)">goal ${P().goalWeight}</text>
    ${area}${proj}
    ${ws.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="url(#ringGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${ws.map(w => `<circle cx="${X(w.date)}" cy="${Y(w.kg)}" r="3.5" fill="#fff"/>`).join('')}
    <text x="${pl}" y="${H - 6}" font-size="10" fill="rgba(255,255,255,.4)">${fmtEN(parseKey(startK))}</text>
    <text x="${W - pr}" y="${H - 6}" font-size="10" text-anchor="end" fill="rgba(255,255,255,.4)">${fmtEN(parseKey(endK))}</text></svg>`;
}
function weekBars() {
  const W = 340, H = 150, tgt = target(), days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(new Date(), -i); days.push([d, dayTotals(keyOf(d)), dayStatus(keyOf(d))]); }
  const max = Math.max(tgt * 1.4, ...days.map(x => x[1].kcal));
  const bw = 30, gap = (W - 7 * bw) / 8, base = H - 22, Y = v => base - (v / max) * (base - 10);
  const col = { good: 'var(--good)', over: 'var(--warn)', low: '#60a5fa' };
  return `<svg viewBox="0 0 ${W} ${H}">
    <line x1="0" x2="${W}" y1="${Y(tgt)}" y2="${Y(tgt)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 4"/>
    <text x="${W - 2}" y="${Y(tgt) - 4}" text-anchor="end" font-size="10" fill="rgba(255,255,255,.5)">${tgt}</text>
    ${days.map(([d, t, st], i) => { const x = gap + i * (bw + gap); const h = base - Y(t.kcal);
      return `<rect x="${x}" y="${base - h}" width="${bw}" height="${Math.max(h, 2)}" rx="8" fill="${col[st] || 'rgba(255,255,255,.12)'}" opacity=".9"/>
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.5)">${fmtEN(d, { weekday: 'narrow' })}</text>
      ${t.kcal ? `<text x="${x + bw / 2}" y="${base - h - 5}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.7)">${t.kcal}</text>` : ''}`; }).join('')}
  </svg>`;
}

// =========================================================
//  SHEETS
// =========================================================
let sheetOnClose = null;
function openSheet(html, onClose) {
  const sh = $('#sheet'), bk = $('#sheetBack');
  sh.innerHTML = `<div class="grab"></div>${html}`; sh.dataset.kind = '';
  bk.hidden = false; sheetOnClose = onClose || null;
  requestAnimationFrame(() => { bk.classList.add('show'); sh.classList.add('show'); });
  sh.scrollTop = 0;
}
function closeSheet() {
  const sh = $('#sheet'), bk = $('#sheetBack');
  sh.classList.remove('show'); bk.classList.remove('show');
  setTimeout(() => { bk.hidden = true; }, 350);
  const cb = sheetOnClose; sheetOnClose = null; cb && cb();
}

// ----- meal detail / customize -----
let mealCtx = null; // {k, slot, id, portion, addons, mode:'plan'|'browse'}
function openMealSheet(ctx) {
  mealCtx = ctx;
  const m = mealById(ctx.id), c = mealCalc(m, ctx.portion, ctx.addons);
  const eaten = ctx.mode === 'plan' && planEntry(ctx.k, ctx.slot);
  const fav = S.favorites.includes(m.id);
  const slot = SLOTS.find(s => s.id === ctx.slot);
  openSheet(`
    <div class="sheet-hero">
      <div class="big-emoji">${m.emoji}</div>
      <h2 class="he">${esc(m.name)}</h2>
      <div class="small muted">${slot ? `${slot.emoji} ${slot.en} · ` : ''}⏱ ${m.min} min</div>
      <div style="margin-top:6px" class="he">${m.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
    </div>
    <div class="card" style="text-align:center;padding:14px">
      <div class="row between"><button class="icon-btn" data-action="fav" data-id="${m.id}">${fav ? '❤️' : '🤍'}</button>
        <div><div class="big-num grad-text" id="mKcal">${c.kcal}</div><div class="tiny muted">kcal · <span id="mProt">${c.p}</span>g protein</div></div>
        <button class="icon-btn" data-action="meal-swap-in-sheet">🔄</button></div>
      <div style="margin-top:14px"><div class="row between small"><span class="muted">Portion</span><b id="mPortion">×${ctx.portion}</b></div>
        <input type="range" min="0.5" max="2" step="0.25" value="${ctx.portion}" data-input="portion" style="margin-top:8px"></div>
    </div>
    <div class="card he"><h3 style="flex-direction:row-reverse">מה בצלחת</h3><div id="mItems">${itemsHtml(m, ctx.portion)}</div></div>
    ${m.addons.length ? `<div class="he"><div class="small muted" style="margin:0 4px 8px">תוספות (לפי החשק)</div>
      ${m.addons.map((a, i) => `<button class="addon ${ctx.addons.includes(i) ? 'on' : ''}" data-action="addon" data-i="${i}"><span>${esc(a[0])}</span><span class="row"><span class="small muted" dir="ltr">+${a[1]}</span><span class="plus">${ctx.addons.includes(i) ? '✓' : '+'}</span></span></button>`).join('')}</div>` : ''}
    <div class="card he" style="margin-top:6px"><h3 style="flex-direction:row-reverse">איך מכינים</h3><div style="line-height:1.6">${esc(m.how)}</div></div>
    ${ctx.mode === 'plan' ? `
      <button class="btn primary block" data-action="meal-eat">${eaten ? '💾 Update' : '✓ I ate this'}</button>
      <div class="grid2" style="margin-top:10px">
        <button class="btn" data-action="meal-save">Save for later</button>
        <button class="btn" data-action="ate-else" data-slot="${ctx.slot}">Ate something else</button>
      </div>
      ${eaten ? `<button class="btn block" style="margin-top:10px;color:var(--bad)" data-action="meal-uneat">Un-check this meal</button>` : ''}`
    : `<div class="small muted" style="margin:4px 0 8px">Put it on today’s menu as…</div>
      <div class="grid3">${SLOTS.filter(s => m.pools.includes(s.pool)).map(s => `<button class="btn sm" data-action="plan-as" data-slot="${s.id}">${s.emoji} ${s.en}${s.id === 'snack1' ? ' 1' : s.id === 'snack2' ? ' 2' : ''}</button>`).join('')}</div>
      <button class="btn primary block" style="margin-top:12px" data-action="browse-log">✓ Log it now</button>`}
  `);
}
function itemsHtml(m, portion) {
  return m.items.map(i => `<div class="ing"><span>${esc(i[0])} <span class="faint small">${esc(i[1])}${portion !== 1 ? ` <bdi dir="ltr">×${portion}</bdi>` : ''}</span></span><span class="muted small" dir="ltr">${r5(i[2] * portion)}</span></div>`).join('');
}
function refreshMealSheet() {
  const m = mealById(mealCtx.id), c = mealCalc(m, mealCtx.portion, mealCtx.addons);
  $('#mKcal').textContent = c.kcal; $('#mProt').textContent = c.p; $('#mPortion').textContent = '×' + mealCtx.portion;
  $('#mItems').innerHTML = itemsHtml(m, mealCtx.portion);
}
function logMealEntry(k, slot, m, portion, addons, planSlot) {
  const c = mealCalc(m, portion, addons), d = getDay(k);
  const name = m.name + (addons.length ? ' + ' + addons.map(i => m.addons[i][0]).join(', ') : '');
  const existing = planSlot && d.entries.find(e => e.planSlot === planSlot);
  const entry = { id: existing?.id || uid(), name, emoji: m.emoji, kcal: c.kcal, p: c.p, slot, mealId: m.id, qty: portion, planSlot: planSlot || null, t: Date.now() };
  if (existing) Object.assign(existing, entry); else d.entries.push(entry);
  save();
}

// ----- meal picker (swap) -----
function openPicker(k, slot, tag = null) {
  const s = SLOTS.find(x => x.id === slot), cur = ensurePlan(k)[slot].id;
  let list = MEALS.filter(m => m.pools.includes(s.pool));
  const tags = [...new Set(list.flatMap(m => m.tags))].slice(0, 12);
  if (tag === '❤️') list = list.filter(m => S.favorites.includes(m.id)); else if (tag) list = list.filter(m => m.tags.includes(tag));
  openSheet(`
    <h2>${s.emoji} Swap ${s.en.toLowerCase()}</h2>
    <div class="small muted" style="margin-bottom:12px">~${r5(slotTarget(slot))} kcal fits this meal · portions auto-adjust</div>
    <button class="btn primary block" data-action="pick-random" data-k="${k}" data-slot="${slot}" style="margin-bottom:12px">🎲 Surprise me</button>
    <div class="chips he" style="margin-bottom:12px"><button class="chip ${!tag ? 'on' : ''}" data-action="pick-tag" data-k="${k}" data-slot="${slot}" data-v="">הכל</button><button class="chip ${tag === '❤️' ? 'on' : ''}" data-action="pick-tag" data-k="${k}" data-slot="${slot}" data-v="❤️">❤️</button>${tags.map(t => `<button class="chip ${tag === t ? 'on' : ''}" data-action="pick-tag" data-k="${k}" data-slot="${slot}" data-v="${t}">${t}</button>`).join('')}</div>
    ${list.map(m => { const p = autoPortion(m, slot), c = mealCalc(m, p); return `
      <button class="pick ${m.id === cur ? 'cur' : ''}" data-action="pick" data-k="${k}" data-slot="${slot}" data-id="${m.id}">
        <div class="meal-emoji" style="width:46px;height:46px;font-size:24px">${m.emoji}</div>
        <div class="grow he" style="text-align:right"><div style="font-weight:600">${esc(m.name)} ${S.favorites.includes(m.id) ? '❤️' : ''}</div><div class="tiny muted">${m.tags.slice(0, 3).join(' · ')}</div></div>
        <div class="small muted" style="text-align:right">${c.kcal}<div class="tiny faint">kcal</div></div></button>`; }).join('') || '<div class="empty-state">Nothing here yet</div>'}
  `);
}
function setPlanMeal(k, slot, id) {
  const plan = ensurePlan(k), m = mealById(id);
  plan[slot] = { id, portion: autoPortion(m, slot), addons: [] };
  save();
}

// ----- quick add -----
let qa = { k: null, slot: null, cat: 'all', q: '', tab: 'foods', sel: null, qty: 1 };
function openQuickAdd(k = todayKey(), slot = null) {
  qa = { k, slot: slot || slotByTime(), cat: 'all', q: '', tab: 'foods', sel: null, qty: 1 };
  renderQuickAdd();
}
function renderQuickAdd() {
  const cats = ['all', ...new Set(FOODS.map(f => f[5]))];
  const recent = [];
  Object.keys(S.days).sort().reverse().forEach(k => S.days[k].entries.slice().reverse().forEach(e => { if (!recent.some(r => r.name === e.name) && recent.length < 15) recent.push(e); }));
  const q = qa.q.trim();
  const foods = FOODS.map((f, i) => [f, i]).filter(([f]) => (qa.cat === 'all' || f[5] === qa.cat) && (!q || f[0].includes(q) || f[5].includes(q)));
  const mealHits = q ? MEALS.filter(m => m.name.includes(q)).slice(0, 4) : [];
  const dayLbl = qa.k === todayKey() ? 'today' : fmtEN(parseKey(qa.k), { weekday: 'short', month: 'short', day: 'numeric' });
  let body = '';
  if (qa.sel !== null) {
    const f = FOODS[qa.sel];
    body = `<div class="sheet-hero"><div class="big-emoji">${f[4]}</div><h2 class="he">${esc(f[0])}</h2><div class="small muted he">${esc(f[1])}</div></div>
      <div class="card center"><div class="big-num grad-text">${r5(f[2] * qa.qty)}</div><div class="tiny muted">kcal · ${Math.round(f[3] * qa.qty)}g protein</div>
        <div class="seg" style="margin-top:14px">${[0.5, 1, 1.5, 2, 3].map(x => `<button class="${qa.qty === x ? 'on' : ''}" data-action="qa-qty" data-v="${x}">×${x}</button>`).join('')}</div></div>
      ${slotSeg()}
      <button class="btn primary block" data-action="qa-add-food">＋ Add to ${dayLbl}</button>
      <button class="btn block" style="margin-top:8px" data-action="qa-back">‹ Back</button>`;
  } else if (qa.tab === 'custom') {
    body = `<div class="field"><label>What did you eat?</label><input class="input" id="cName" placeholder="e.g. עוגה ביום הולדת"></div>
      <div class="grid2"><div class="field"><label>Calories</label><input class="input" id="cKcal" type="number" inputmode="numeric" placeholder="kcal"></div>
      <div class="field"><label>Protein (optional)</label><input class="input" id="cProt" type="number" inputmode="numeric" placeholder="g"></div></div>
      ${slotSeg()}
      <button class="btn primary block" data-action="qa-add-custom">＋ Add to ${dayLbl}</button>
      <div class="small faint center" style="margin-top:10px">Not sure? A rough guess is way better than not logging 💛</div>`;
  } else if (qa.tab === 'recent') {
    body = recent.length ? recent.map((e, i) => `<button class="food-row" data-action="qa-recent" data-i="${i}"><span class="e">${e.emoji || '🍽️'}</span><span class="grow he" style="text-align:right">${esc(e.name)}</span><span class="small muted">${e.kcal}</span></button>`).join('')
      : '<div class="empty-state"><span class="ee">🕐</span>Things you log will show up here</div>';
    qa._recent = recent;
  } else {
    body = `<input class="input he" style="text-align:right;margin-bottom:10px" placeholder="🔎 חיפוש מאכל..." value="${esc(qa.q)}" data-input="qa-search" id="qaSearch">
      <div class="chips he" style="margin-bottom:8px">${cats.map(c => `<button class="chip ${qa.cat === c ? 'on' : ''}" data-action="qa-cat" data-v="${c}">${c === 'all' ? 'הכל' : c}</button>`).join('')}</div>
      <div id="qaList">${mealHits.map(m => `<button class="food-row" data-action="view-meal" data-id="${m.id}"><span class="e">${m.emoji}</span><span class="grow he" style="text-align:right">${esc(m.name)} <span class="tag">מתכון</span></span><span class="small muted">${mealCalc(m).kcal}</span></button>`).join('')}
      ${foods.map(([f, i]) => `<button class="food-row" data-action="qa-pick" data-i="${i}"><span class="e">${f[4]}</span><span class="grow he" style="text-align:right"><div>${esc(f[0])}</div><div class="tiny faint">${esc(f[1])}</div></span><span class="small muted">${f[2]}</span></button>`).join('')
      || `<div class="empty-state"><span class="ee">🔍</span>Not found — use <b>Custom</b> to add it</div>`}</div>`;
  }
  const html = `<h2>Log food <span class="small muted" style="font-weight:400">· ${dayLbl}</span></h2>
    ${qa.sel === null ? `<div class="seg" style="margin:12px 0">${[['foods', '🔎 Foods'], ['recent', '🕐 Recent'], ['custom', '✏️ Custom']].map(t => `<button class="${qa.tab === t[0] ? 'on' : ''}" data-action="qa-tab" data-v="${t[0]}">${t[1]}</button>`).join('')}</div>` : ''}
    ${body}`;
  if ($('#sheet').classList.contains('show') && $('#sheet').dataset.kind === 'qa') { $('#sheet').innerHTML = `<div class="grab"></div>${html}`; }
  else { openSheet(html); }
  $('#sheet').dataset.kind = 'qa';
}
function slotSeg() {
  return `<div class="small muted" style="margin:4px 0 8px">Which meal?</div><div class="seg" style="margin-bottom:14px">${SLOTS.map(s => `<button class="${qa.slot === s.id ? 'on' : ''}" data-action="qa-slot" data-v="${s.id}">${s.emoji}</button>`).join('')}</div>`;
}
function addEntry(k, e) {
  getDay(k).entries.push({ id: uid(), t: Date.now(), ...e });
  save(); buzz(15);
  toast(`＋ ${e.kcal} kcal logged`);
  checkBadges();
}

// ----- day sheet (calendar) -----
function openDaySheet(k) {
  const d = S.days[k], t = dayTotals(k), st = dayStatus(k), w = S.weights.find(x => x.date === k);
  const date = parseKey(k);
  const stTxt = { good: ['🎯 On target', 'var(--good)'], over: ['A little over — that’s life 💛', 'var(--warn)'], low: ['Ate too little — your body needs fuel!', '#60a5fa'] }[st];
  openSheet(`
    <h2>${fmtEN(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
    <div class="small muted he" style="text-align:left">${fmtHE(date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <div class="grid3" style="margin:14px 0">
      <div class="card center" style="margin:0"><div style="font-size:22px;font-weight:700">${t.kcal}</div><div class="tiny muted">kcal</div></div>
      <div class="card center" style="margin:0"><div style="font-size:22px;font-weight:700">${t.p}g</div><div class="tiny muted">protein</div></div>
      <div class="card center" style="margin:0"><div style="font-size:22px;font-weight:700">${d?.water || 0}💧</div><div class="tiny muted">water</div></div>
    </div>
    ${stTxt ? `<div class="small" style="color:${stTxt[1]};margin-bottom:10px">${stTxt[0]}</div>` : ''}
    ${w ? `<div class="small muted" style="margin-bottom:8px">⚖️ Weighed in: <b style="color:var(--text)">${w.kg} kg</b></div>` : ''}
    ${d?.mood ? `<div class="small muted" style="margin-bottom:8px">Mood: <span style="font-size:20px">${d.mood}</span></div>` : ''}
    <div class="card">${d?.entries.length ? SLOTS.map(s => { const es = d.entries.filter(e => e.slot === s.id); return es.length ? `<div class="tiny muted" style="margin-top:6px">${s.emoji} ${s.en.toUpperCase()}</div>${es.map(e => entryRow(e, k)).join('')}` : ''; }).join('')
      : '<div class="empty-state"><span class="ee">📝</span>Nothing logged this day</div>'}
      ${d?.exercise?.length ? `<div class="divider"></div>${d.exercise.map(x => `<div class="entry"><span class="e">${x.emoji}</span><span class="grow he" style="text-align:left">${esc(x.name)} · ${x.min}′</span><span class="small muted">−${x.kcal}</span></div>`).join('')}` : ''}
    </div>
    ${k <= todayKey() ? `<button class="btn primary block" data-action="day-add" data-k="${k}">＋ Add food to this day</button>` : ''}
  `);
}

// ----- weight -----
function openWeightSheet() {
  let v = currentWeight();
  openSheet(`
    <div class="sheet-hero"><div class="big-emoji">⚖️</div><h2>Today’s weigh-in</h2><div class="small muted">Best: morning, after the bathroom, before eating</div></div>
    <div class="row" style="justify-content:center;gap:16px;margin:18px 0">
      <button class="icon-btn" style="width:56px;height:56px;font-size:26px" data-action="w-step" data-v="-0.1">−</button>
      <div class="center"><input id="wIn" class="big-num grad-text" style="width:140px;text-align:center;background:none;border:0;outline:none" type="number" step="0.1" inputmode="decimal" value="${v}"><div class="small muted">kg</div></div>
      <button class="icon-btn" style="width:56px;height:56px;font-size:26px" data-action="w-step" data-v="0.1">＋</button>
    </div>
    <button class="btn primary block" data-action="w-save">Save</button>
    <div class="small faint center" style="margin-top:12px">Weight jumps ±1 kg day-to-day from water, salt & hormones. Watch the trend, not one number 💛</div>
  `);
}

// ----- exercise -----
let exSel = 0, exMin = 30;
function openExerciseSheet() {
  const kcal = Math.round(EXERCISES[exSel][2] * exMin * (currentWeight() / 55));
  openSheet(`
    <h2>🏃‍♀️ Add movement</h2>
    <div class="chips he" style="flex-wrap:wrap;margin:14px 0">${EXERCISES.map((x, i) => `<button class="chip ${i === exSel ? 'on' : ''}" data-action="ex-pick" data-i="${i}">${x[1]} ${x[0]}</button>`).join('')}</div>
    <div class="row between small"><span class="muted">Minutes</span><b id="exMinL">${exMin} min</b></div>
    <input type="range" min="5" max="120" step="5" value="${exMin}" data-input="ex-min" style="margin:10px 0 16px">
    <div class="card center"><div class="big-num grad-text" id="exKcal">${kcal}</div><div class="tiny muted">kcal burned (approx.) — added to today’s food budget</div></div>
    <button class="btn primary block" data-action="ex-save">Add</button>`);
}

// ----- settings -----
function openSettings() {
  const p = P(), s = S.settings;
  const acts = [[1.2, 'Mostly sitting'], [1.375, 'Light'], [1.55, 'Active'], [1.725, 'Very active']];
  const themes = [['rose', '#ff5fa2', '#a66bff'], ['ocean', '#2fe0c4', '#5b8cff'], ['sunset', '#ff9f45', '#ff4d6d'], ['lilac', '#c084fc', '#f472b6'], ['lime', '#bef264', '#22d3ee']];
  openSheet(`
    <h2>⚙️ Settings</h2><div class="small muted" style="margin-bottom:16px">Everything is saved only on this phone.</div>
    <div class="field"><label>Theme</label><div class="row" style="gap:12px">${themes.map(t => `<button class="theme-dot ${s.theme === t[0] ? 'on' : ''}" style="background:linear-gradient(135deg,${t[1]},${t[2]})" data-action="theme" data-v="${t[0]}"></button>`).join('')}</div></div>
    <div class="grid2">
      <div class="field"><label>Name</label><input class="input" id="sName" value="${esc(p.name)}"></div>
      <div class="field"><label>שם בעברית</label><input class="input he" id="sNameHe" value="${esc(p.nameHe)}"></div>
      <div class="field"><label>Height (cm)</label><input class="input" id="sH" type="number" inputmode="numeric" value="${p.heightCm}"></div>
      <div class="field"><label>Age</label><input class="input" id="sAge" type="number" inputmode="numeric" value="${p.age}"></div>
      <div class="field"><label>Start weight</label><input class="input" id="sSW" type="number" step="0.1" inputmode="decimal" value="${p.startWeight}"></div>
      <div class="field"><label>Goal weight</label><input class="input" id="sGW" type="number" step="0.1" inputmode="decimal" value="${p.goalWeight}"></div>
    </div>
    <div class="tiny faint" style="margin:-6px 0 14px">Healthy minimum for your height: ${minHealthyWeight()} kg (BMI 18.5)</div>
    <div class="field"><label>How active are you?</label><div class="seg">${acts.map(a => `<button class="${p.activity === a[0] ? 'on' : ''}" data-action="set-act" data-v="${a[0]}">${a[1]}</button>`).join('')}</div></div>
    <div class="field"><label>Pace</label><div class="seg">${[['gentle', '🐢 Gentle'], ['steady', '🚶‍♀️ Steady'], ['faster', '🏃‍♀️ Faster']].map(a => `<button class="${p.pace === a[0] ? 'on' : ''}" data-action="set-pace" data-v="${a[0]}">${a[1]}</button>`).join('')}</div>
      <div class="tiny faint" style="margin-top:6px">Daily goal: <b>${target()} kcal</b> · never below ${FLOOR()} so you’re never starving.</div></div>
    <div class="field"><label>Water goal (cups)</label><input class="input" id="sWater" type="number" min="4" max="14" value="${s.waterGoal}"></div>
    <div class="field"><label>Meal times</label><div class="grid2">${SLOTS.map(sl => `<div><div class="tiny muted" style="margin-bottom:4px">${sl.emoji} ${sl.en}${sl.id === 'snack1' ? ' (AM)' : sl.id === 'snack2' ? ' (PM)' : ''}</div><input class="input" type="time" id="t_${sl.id}" value="${s.times[sl.id]}"></div>`).join('')}</div></div>
    <button class="btn primary block" data-action="settings-save">Save changes</button>
    <div class="divider"></div>
    <h3 style="margin:0 0 10px;font-size:15px">🔔 Meal reminders</h3>
    <button class="btn block" data-action="notify-on">${s.notify ? '✅ App notifications on — send test' : '🔔 Turn on app notifications'}</button>
    <div class="tiny faint" style="margin:6px 0 10px">Works while the app is open or recently used. On iPhone the app must be added to the Home Screen first.</div>
    <button class="btn block" data-action="ics">📅 Add daily reminders to my phone calendar</button>
    <div class="tiny faint" style="margin:6px 0 4px">Most reliable option — your calendar will ping you at every meal time, even when the app is closed.</div>
    <div class="divider"></div>
    <div class="grid2"><button class="btn" data-action="backup">💾 Backup</button><button class="btn" data-action="restore">📂 Restore</button></div>
    <input type="file" id="restoreFile" accept="application/json" hidden>
    <button class="btn block" style="margin-top:10px;color:var(--bad)" data-action="reset">Reset everything</button>
    <div class="tiny faint center" style="margin-top:16px">Made with love 💛 Calorie numbers are estimates. If you ever feel unwell, dizzy, or obsessed with numbers — talk to someone you trust or a doctor/dietitian.</div>
  `);
}

// =========================================================
//  NOTIFICATIONS & CALENDAR REMINDERS
// =========================================================
let reminderTimers = [];
function scheduleReminders() {
  reminderTimers.forEach(clearTimeout); reminderTimers = [];
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  SLOTS.forEach(s => {
    const [h, m] = S.settings.times[s.id].split(':').map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const ms = at - now;
    if (ms > 0 && ms < 86400000) reminderTimers.push(setTimeout(() => {
      if (planEntry(todayKey(), s.id)) return;
      const meal = mealById(ensurePlan()[s.id].id);
      notify(`${s.emoji} ${s.en} time, ${P().name}!`, `${meal.name} ${meal.emoji} — ${mealCalc(meal, ensurePlan()[s.id].portion).kcal} kcal`);
    }, ms));
  });
}
async function notify(title, body) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'meal', renotify: true });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch (e) { new Notification(title, { body }); }
}
function downloadICS() {
  const d = new Date(), ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Glow//Meals//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${P().name} meals`];
  const msg = { breakfast: 'Breakfast time! Fuel up ☀️', snack1: 'Snack time 🍎 (keeps the hunger away)', lunch: 'Lunch time! ☀️', snack2: 'Afternoon snack 🍓', dinner: 'Dinner time 🌙' };
  SLOTS.forEach(s => {
    const [h, m] = S.settings.times[s.id].split(':');
    const endM = (Number(m) + 15) % 60, endH = (Number(h) + (Number(m) + 15 >= 60 ? 1 : 0)) % 24;
    lines.push('BEGIN:VEVENT', `UID:glow-${CONFIG.id}-${s.id}@glow`, `DTSTAMP:${stamp}`,
      `DTSTART:${ymd}T${h}${m}00`, `DTEND:${ymd}T${pad(endH)}${pad(endM)}00`, 'RRULE:FREQ=DAILY',
      `SUMMARY:${s.emoji} ${msg[s.id]}`, `DESCRIPTION:Open your app to see today's ${s.en.toLowerCase()} 💛`,
      `URL:${location.href.split('#')[0]}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${msg[s.id]}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  downloadFile(`${CONFIG.id}-meal-reminders.ics`, lines.join('\r\n'), 'text/calendar');
  toast('📅 Open the file → “Add All” to your calendar');
}
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// =========================================================
//  COACH (offline, rule-based)
// =========================================================
const EN_FOODS = { falafel: 'פלאפל', shawarma: 'שווארמה', pizza: 'פיצה', hummus: 'חומוס', egg: 'ביצה', omelet: 'חביתה', banana: 'בננה', apple: 'תפוח', bamba: 'במבה', bisli: 'ביסלי', sushi: 'סושי', burger: 'המבורגר', hamburger: 'המבורגר', schnitzel: 'שניצל', pita: 'פיתה', lafa: 'לאפה', cottage: 'קוטג', tuna: 'טונה', chicken: 'חזה עוף', salmon: 'סלמון', rice: 'אורז', pasta: 'פסטה', bread: 'לחם', avocado: 'אבוקדו', chocolate: 'שוקולד', 'ice cream': 'גלידה', watermelon: 'אבטיח', tahini: 'טחינה', yogurt: 'יוגורט', coffee: 'קפה', latte: 'קפה הפוך', cola: 'קולה', coke: 'קולה', croissant: 'קרואסון', bourek: 'בורקס', burek: 'בורקס', malawach: 'מלאווח', jachnun: 'גחנון', sabich: 'סביח', shakshuka: 'שקשוקה', date: 'תמר', almond: 'שקדים', popcorn: 'פופקורן', fries: 'ציפס', chips: 'תפוציפס', orange: 'תפוז', grape: 'ענבים', milk: 'חלב', cheese: 'גבינה', oat: 'שיבולת', mango: 'מנגו', melon: 'מלון', strawberr: 'תותים', cookie: 'עוגיות', cake: 'עוגת', wafer: 'וופל', 'protein bar': 'חטיף חלבון', wine: 'יין', beer: 'בירה', noodle: 'נודלס', toast: 'טוסט', salad: 'סלט', quinoa: 'קינואה', couscous: 'קוסקוס', potato: 'תפוח אדמה', 'sweet potato': 'בטטה', tofu: 'טופו', 'peanut butter': 'חמאת בוטנים', olive: 'זיתים' };
const SUGGESTIONS = [['How much can I still eat?', 'כמה נשאר לי היום?'], ['I’m hungry 😩', 'אני רעבה'], ['Craving something sweet', 'בא לי מתוק'], ['When will I reach my goal?', 'מתי אגיע ליעד?'], ['Going out tonight', 'יוצאת הערב למסעדה'], ['I overate 😔', 'אכלתי יותר מדי'], ['How many calories in falafel?', 'כמה קלוריות בשווארמה?'], ['The scale went up', 'המשקל עלה']];
function mountCoach() {
  const chat = $('#chat');
  if (!S.chat.length) S.chat.push({ me: false, t: `Hey ${P().name}! 💛 I’m your pocket coach. Ask me about calories, what to eat, cravings, eating out — in English or Hebrew.\n\nהיי ${P().nameHe}! אפשר לשאול אותי גם בעברית 😊` });
  chat.innerHTML = S.chat.slice(-40).map(m => `<div class="msg ${m.me ? 'me' : 'bot'}" dir="${isHe(m.t) && !/^[A-Za-z]/.test(m.t) ? 'rtl' : 'ltr'}">${esc(m.t)}</div>`).join('');
  const sugg = $('#sugg'), lang = Math.random() < 0.5 ? 0 : 1;
  sugg.innerHTML = SUGGESTIONS.map(s => `<button class="chip" data-action="ask" data-q="${esc(s[lang])}">${esc(s[lang])}</button>`).join('');
  $('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) { $('#chatIn').value = ''; ask(v); } };
  window.scrollTo(0, document.body.scrollHeight);
}
function ask(q) {
  S.chat.push({ me: true, t: q }); save(); checkBadges();
  const chat = $('#chat'); if (!chat) return;
  chat.insertAdjacentHTML('beforeend', `<div class="msg me" dir="${isHe(q) ? 'rtl' : 'ltr'}">${esc(q)}</div><div class="msg bot typing" id="typing"><span></span><span></span><span></span></div>`);
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  setTimeout(() => {
    const a = coachReply(q);
    S.chat.push({ me: false, t: a }); if (S.chat.length > 80) S.chat = S.chat.slice(-60); save();
    $('#typing')?.remove();
    chat.insertAdjacentHTML('beforeend', `<div class="msg bot" dir="${isHe(a) && !/^[A-Za-z]/.test(a) ? 'rtl' : 'ltr'}">${esc(a)}</div>`);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, 650 + Math.random() * 500);
}
function coachReply(raw) {
  const he = isHe(raw), t = raw.toLowerCase().replace(/[׳']/g, '');
  const L = (en, h) => (he ? h : en);
  const has = (...words) => words.some(w => t.includes(w));
  const k = todayKey(), tot = dayTotals(k), left = target() + tot.burn - tot.kcal;
  const name = he ? P().nameHe : P().name;
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const snackIdeas = (max, sweet) => {
    let l = MEALS.filter(m => m.pools.includes('snack') && mealCalc(m).kcal <= Math.max(max, 90));
    const sw = l.filter(m => m.tags.includes('מתוק') || m.tags.includes('פינוק'));
    if (sweet && sw.length) l = sw;
    return l.sort(() => Math.random() - .5).slice(0, 3).map(m => `${m.emoji} ${m.name} (${mealCalc(m).kcal})`).join('\n');
  };

  // food calorie lookup
  const norm = s => s.replace(/[׳']/g, '');
  let tq = t;
  Object.entries(EN_FOODS).forEach(([en, h]) => { if (new RegExp('\\b' + en).test(tq)) tq += ' ' + h; });
  const foodHits = FOODS.filter(f => { const n = norm(f[0]).toLowerCase(); return tq.includes(n) || n.split(/[\s/()-]+/).some(w => w.length > 3 && tq.includes(w)); }).slice(0, 4);
  const mealHits = MEALS.filter(m => tq.includes(norm(m.name))).slice(0, 2);
  const lookup = () => { const lines = [...mealHits.map(m => L(`${m.emoji} ${m.name} — ~${mealCalc(m).kcal} kcal`, `${m.emoji} ${m.name} — כ־${mealCalc(m).kcal} קלוריות`)),
    ...foodHits.map(f => L(`${f[4]} ${f[0]} (${f[1]}) — ~${f[2]} kcal, ${f[3]}g protein`, `${f[4]} ${f[0]} (${f[1]}) — כ־${f[2]} קלוריות, ${f[3]} גרם חלבון`))];
    return L(`Here’s what I know:\n${lines.join('\n')}\n\nYou have ${Math.max(0, left)} kcal left today.`, `הנה מה שאני יודעת:\n${lines.join('\n')}\n\nנשארו לך היום ${Math.max(0, left)} קלוריות.`); };
  const asksCal = has('calor', 'kcal', 'קלורי', 'כמה יש', 'how much is', 'how many');

  if (has('thank', 'תודה', 'love you', 'אוהבת')) return L(`Anytime, ${name}! 💛 Proud of you.`, `תמיד, ${name}! 💛 גאה בך.`);
  if (has('overate', 'binge', 'ate too much', 'ruined', 'messed up', 'cheat', 'יותר מדי', 'התפרעתי', 'חרגתי', 'הרסתי', 'נפלתי', 'בולמוס', 'פישלתי'))
    return L(`Hey, breathe 💛 One meal can’t undo your progress — 1 kg of fat is ~7,700 kcal, so one big meal barely moves it. Don’t skip meals tomorrow to “make up” for it — that just makes you hungrier. Drink water, log it honestly, and go right back to your normal plan. That’s what people who succeed actually do.`,
      `היי, נשימה 💛 ארוחה אחת לא מוחקת את ההתקדמות שלך — קילו שומן זה בערך 7,700 קלוריות, אז ארוחה גדולה כמעט לא מזיזה. אל תדלגי על ארוחות מחר כדי “לפצות” — זה רק יגרום לך להיות רעבה יותר. שתי מים, תרשמי בכנות, וחוזרות לתוכנית הרגילה. ככה בדיוק מצליחים.`);
  if (asksCal && (foodHits.length || mealHits.length)) return lookup();
  if (has('left', 'remaining', 'still eat', 'budget', 'נשאר', 'מותר לי', 'עוד לאכול'))
    return left >= 0 ? L(`You’ve eaten ${tot.kcal} kcal and have ${left} left today 🎯 ${left > 300 ? 'Plenty of room for a proper meal!' : 'Enough for a nice snack.'}`, `אכלת ${tot.kcal} קלוריות ונשארו לך עוד ${left} להיום 🎯 ${left > 300 ? 'יש מקום לארוחה שלמה!' : 'מספיק לנשנוש טוב.'}`)
      : L(`You’re ${-left} kcal over today — no drama. Tomorrow you start fresh 💛`, `עברת ב־${-left} קלוריות היום — בלי דרמות. מחר דף חדש 💛`);
  if (has('protein', 'חלבון'))
    return L(`Your protein goal is ~${proteinTarget()} g/day (today: ${tot.p} g). Protein = staying full longer. Easy wins: eggs, cottage, PRO yogurt, tuna, chicken, lentils, Bulgarian 5%.`, `יעד החלבון שלך ~${proteinTarget()} גרם ביום (היום: ${tot.p}). חלבון = שובע לאורך זמן. הכי קל: ביצים, קוטג׳, יוגורט PRO, טונה, עוף, עדשים, בולגרית 5%.`);
  if (has('exercise', 'workout', 'gym', 'walk', 'sport', 'run', 'ספורט', 'אימון', 'הליכה', 'כושר', 'ריצה', 'חדר'))
  if (has('water', 'drink', 'thirsty', 'מים', 'לשתות', 'שתייה'))
    return L(`Aim for ${S.settings.waterGoal} cups a day (you’re at ${getDay().water}). Water keeps hunger lower and energy higher. Sparkling water with lemon or zero drinks count too! 💧`, `המטרה: ${S.settings.waterGoal} כוסות ביום (את ב־${getDay().water}). מים מורידים רעב ומעלים אנרגיה. סודה עם לימון ומשקאות זירו נחשבים! 💧`);
  if (has('when', 'how long', 'reach', 'goal', 'מתי', 'כמה זמן', 'יעד', 'אגיע')) { const [en, h] = projectionText(); return L(en + ' Keep going — slow and steady wins 🐢✨', h + ' ממשיכות — לאט ובטוח 🐢✨'); }
  if (has('sweet', 'chocolate', 'dessert', 'sugar', 'מתוק', 'שוקולד', 'קינוח', 'סוכר', 'גלידה'))
    return L(`Sweet cravings are normal! Don’t fight them — plan them:\n${snackIdeas(left, true)}\n\nTip: eat it slowly, sitting down, with tea. Enjoy it 100%.`, `חשק למתוק זה נורמלי! לא נלחמים בו — מתכננים אותו:\n${snackIdeas(left, true)}\n\nטיפ: לאכול לאט, בישיבה, עם תה. ולהנות מזה עד הסוף.`);
  if (has('hungry', 'starving', 'craving', 'snack', 'רעבה', 'רעב', 'נשנוש', 'בא לי', 'נשנש'))
    return L(`First, drink a glass of water and wait 10 min — thirst often feels like hunger 💧 Still hungry? Then eat! Ideas that fit your ${Math.max(0, left)} kcal left:\n${snackIdeas(Math.max(left, 120))}\n\nAnd if you’re hungry a lot, add more protein & veggies to meals.`,
      `קודם כוס מים ו־10 דקות — הרבה פעמים צמא מרגיש כמו רעב 💧 עדיין רעבה? אז אוכלים! רעיונות שמתאימים ל־${Math.max(0, left)} הקלוריות שנשארו:\n${snackIdeas(Math.max(left, 120))}\n\nואם את רעבה הרבה — להוסיף חלבון וירקות לארוחות.`);
  if (has('restaurant', 'party', 'going out', 'eat out', 'friends', 'wedding', 'pizza', 'מסעדה', 'מסיבה', 'יוצאת', 'אירוע', 'חתונה', 'חברות', 'בת מצווה', 'בר מצווה', 'יום הולדת', 'שישי'))
    return L(`Go and have fun! 🎉 Tips:\n• Eat normal, lighter meals earlier — don’t starve all day\n• Have a protein snack before you go\n• Start with salad / something fresh\n• Pick the one thing you REALLY want and enjoy it\n• Water between drinks\n• Log it roughly after — no guilt`,
      `לכי ותהני! 🎉 טיפים:\n• לאכול ארוחות רגילות וקלילות יותר במהלך היום — לא לצום!\n• נשנוש חלבון לפני שיוצאים\n• להתחיל מסלט או משהו טרי\n• לבחור את הדבר האחד שבאמת בא לך — ולהנות ממנו\n• מים בין לבין\n• לרשום בערך אחר כך, בלי רגשות אשם`);
  if (has('what should i eat', 'what to eat', 'idea', 'cook', 'dinner', 'lunch', 'breakfast', 'מה לאכול', 'מה להכין', 'רעיון', 'ארוחת', 'צהריים', 'מה אוכלים')) {
    const slot = slotByTime(), s = SLOTS.find(x => x.id === slot);
    const opts = MEALS.filter(m => m.pools.includes(s.pool)).sort(() => Math.random() - .5).slice(0, 3);
    return L(`For ${s.en.toLowerCase()} (~${r5(slotTarget(slot))} kcal) how about:\n${opts.map(m => `${m.emoji} ${m.name} — ${mealCalc(m, autoPortion(m, slot)).kcal} kcal`).join('\n')}\n\nTap 🔄 on the meal in “Today” to swap it in!`,
      `ל${s.he} (~${r5(slotTarget(slot))} קלוריות) מה דעתך על:\n${opts.map(m => `${m.emoji} ${m.name} — ${mealCalc(m, autoPortion(m, slot)).kcal}`).join('\n')}\n\nלחצי על 🔄 ליד הארוחה במסך הבית כדי להחליף!`);
  }
  if (has('stuck', 'plateau', 'not losing', 'went up', 'gained', 'scale', 'נתקעתי', 'לא יורדת', 'עליתי', 'עלה', 'המשקל', 'משקל', 'תקועה'))
    return L(`Totally normal! Weight swings 0.5–1.5 kg day-to-day from water, salt, period & digestion. Look at the weekly trend in Progress 📈. If it hasn’t moved in 3+ weeks: double-check portions (oil & spreads sneak in), add a daily walk, and sleep more. You’re doing great.`,
      `זה לגמרי נורמלי! המשקל קופץ 0.5–1.5 ק״ג מיום ליום בגלל מים, מלח, מחזור ועיכול. תסתכלי על המגמה השבועית במסך ההתקדמות 📈. אם לא זז 3 שבועות+: לבדוק מנות (שמן וממרחים מתגנבים), להוסיף הליכה יומית, ולישון יותר. את עושה עבודה מעולה.`);
  if (has('period', 'pms', 'cramps', 'מחזור', 'וסת', 'פמס'))
    return L(`Around your period it’s normal to be hungrier and hold 1–2 kg of water. Be kind to yourself: a bit more food (like +100–200 kcal) is fine, dark chocolate & bananas help, drink lots of water. The scale will drop back after 💛`,
      `סביב המחזור זה נורמלי להיות רעבה יותר ולאגור 1–2 ק״ג מים. תהיי עדינה עם עצמך: קצת יותר אוכל (100–200 קלוריות) זה בסדר, שוקולד מריר ובננה עוזרים, והרבה מים. המשקל יחזור לרדת אחר כך 💛`);
    return L(`Movement = more food budget + better mood 💃 Easiest win: a 30–40 min walk with a friend or music (~120–160 kcal). Add it in Today → Movement and it adds to what you can eat.`, `תנועה = יותר תקציב לאוכל ומצב רוח טוב יותר 💃 הכי קל: הליכה של 30–40 דקות עם חברה או מוזיקה (~120–160 קלוריות). תוסיפי במסך הבית ← תנועה, וזה מוסיף לך לתקציב.`);
  if (has('sleep', 'tired', 'שינה', 'עייפה', 'לישון'))
    return L(`Sleep matters more than people think — under 7 hours makes you hungrier the next day (hunger hormones!). Try for 8 hours, and no phone in bed 😉`, `שינה חשובה יותר ממה שחושבים — פחות מ־7 שעות גורם להיות רעבה יותר למחרת (הורמוני רעב!). תנסי 8 שעות, ובלי טלפון במיטה 😉`);
  if (has('motivat', 'give up', 'can’t', 'cant', 'hard', 'sad', 'tired of', 'מוטיבציה', 'קשה', 'לוותר', 'עצובה', 'מבואסת', 'אין לי כוח', 'נמאס'))
    { const q = pick(QUOTES.filter(x => x[0] === (he ? 'he' : 'en'))); return L(`I get it 💛 Some days are harder. You don’t need a perfect day, just a decent one.\n\n“${q[1]}”\n\nYou’ve logged ${Object.values(S.days).filter(d => d.entries.length).length} days already. That’s real.`, `מבינה אותך 💛 יש ימים קשים יותר. לא צריך יום מושלם, רק יום סביר.\n\n“${q[1]}”\n\nכבר רשמת ${Object.values(S.days).filter(d => d.entries.length).length} ימים. זה אמיתי.`); }
  if (has('skip', 'fast', 'not eat', 'לדלג', 'לצום', 'לא לאכול', 'פחות אוכל'))
    return L(`Please don’t skip meals 🙏 It backfires: you get super hungry later and overeat, lose muscle and energy. Your plan already has a healthy deficit — eating all 5 meals IS the plan.`, `בבקשה לא לדלג על ארוחות 🙏 זה מתנקם: נהיים רעבות מאוד אחר כך ואוכלות יותר, מאבדות שריר ואנרגיה. בתוכנית שלך כבר יש גירעון בריא — לאכול את כל 5 הארוחות זאת התוכנית.`);
  if (/\b(hi|hey|hello|yo)\b/.test(t) || has('היי', 'שלום', 'מה נשמע', 'מה קורה'))
    return L(`Hey ${name}! ✨ You have ${Math.max(0, left)} kcal left today. What’s up?`, `היי ${name}! ✨ נשארו לך היום ${Math.max(0, left)} קלוריות. מה קורה?`);
  if (foodHits.length || mealHits.length) return lookup();
  if (asksCal) return L(`I don’t have that one 🤔 Try the + button → Foods search, or log a guess with Custom. Rough guesses are totally fine!`, `את זה אין לי 🤔 נסי בכפתור + ← חיפוש מאכלים, או הוסיפי הערכה בלשונית “Custom”. הערכה בערך זה לגמרי בסדר!`);
  return L(`I’m a simple offline coach, so I know about: calories in foods, what to eat, cravings, eating out, the scale, water, protein, sleep & motivation. Try one of the buttons below 👇`,
    `אני קואצ׳ית פשוטה שעובדת בלי אינטרנט 😊 אני יודעת על: קלוריות במאכלים, מה לאכול, חשקים, יציאות, משקל, מים, חלבון, שינה ומוטיבציה. נסי אחד הכפתורים למטה 👇`);
}

// =========================================================
//  EVENTS
// =========================================================
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('[data-tab]');
  const el = e.target.closest('[data-action]');
  if (el) { e.stopPropagation(); handle(el.dataset.action, el); return; }
  if (tabBtn) { ui.tab = tabBtn.dataset.tab; buzz(5); closeSheetIfOpen(); render(); window.scrollTo({ top: 0 }); }
});
function closeSheetIfOpen() { if ($('#sheet').classList.contains('show')) closeSheet(); }
$('#sheetBack').addEventListener('click', closeSheet);

document.addEventListener('input', e => {
  const el = e.target, kind = el.dataset.input;
  if (kind === 'meal-search') { ui.mf.q = el.value.trim(); $('#mealList').innerHTML = mealListHtml(); }
  if (kind === 'portion') { mealCtx.portion = Number(el.value); refreshMealSheet(); }
  if (kind === 'qa-search') { qa.q = el.value; const pos = el.selectionStart; renderQuickAdd(); const n = $('#qaSearch'); n.focus(); n.setSelectionRange(pos, pos); }
  if (kind === 'ex-min') { exMin = Number(el.value); $('#exMinL').textContent = exMin + ' min'; $('#exKcal').textContent = Math.round(EXERCISES[exSel][2] * exMin * (currentWeight() / 55)); }
});

function handle(a, el) {
  const k = todayKey(), ds = el.dataset;
  switch (a) {
    case 'go': ui.tab = ds.tab; render(); window.scrollTo({ top: 0 }); break;
    case 'settings': openSettings(); break;
    case 'quick-add': openQuickAdd(); break;
    case 'install': deferredInstall?.prompt(); break;

    // --- home ---
    case 'open-meal': { const pl = ensurePlan(k)[ds.slot]; openMealSheet({ k, slot: ds.slot, id: pl.id, portion: pl.portion, addons: [...pl.addons], mode: 'plan' }); break; }
    case 'toggle-eaten': {
      const ex = planEntry(k, ds.slot);
      if (ex) { getDay(k).entries = getDay(k).entries.filter(e => e !== ex); save(); buzz(8); }
      else { const pl = ensurePlan(k)[ds.slot]; logMealEntry(k, ds.slot, mealById(pl.id), pl.portion, pl.addons, ds.slot); buzz([10, 30, 10]);
        const msgs = ['Yum! ✨', 'Logged! 💪', 'Nice one 💛', 'כל הכבוד! ✨', 'יאמי! 😋', 'מעולה! 🔥'];
        toast(msgs[(Math.random() * msgs.length) | 0]);
        if (SLOTS.every(s => planEntry(k, s.id))) setTimeout(() => confetti(), 200); }
      checkBadges(); render(); break;
    }
    case 'swap': openPicker(k, ds.slot); break;
    case 'reroll-day': {
      const keep = {}; const plan = ensurePlan(k);
      SLOTS.forEach(s => { if (planEntry(k, s.id)) keep[s.id] = plan[s.id]; });
      keep._salt = uid(); getDay(k).plan = generatePlan(k, keep); save(); buzz(15); toast('🎲 Fresh menu!'); render(); break;
    }
    case 'water': { const d = getDay(k), i = Number(ds.i); d.water = d.water === i + 1 ? i : i + 1; save(); buzz(8); checkBadges(); render(); break; }
    case 'mood': { const d = getDay(k); d.mood = d.mood === ds.m ? null : ds.m; save(); buzz(8); render(); break; }
    case 'add-exercise': openExerciseSheet(); break;
    case 'del-ex': { const d = getDay(k); d.exercise = d.exercise.filter(x => x.id !== ds.id); save(); render(); break; }
    case 'del-entry': {
      const d = getDay(ds.k); d.entries = d.entries.filter(e => e.id !== ds.id); save(); buzz(8);
      if ($('#sheet').classList.contains('show') && $('#sheet').dataset.kind === 'day') { openDaySheet(ds.k); $('#sheet').dataset.kind = 'day'; }
      render(); break;
    }

    // --- meal sheet ---
    case 'addon': { const i = Number(ds.i); mealCtx.addons = mealCtx.addons.includes(i) ? mealCtx.addons.filter(x => x !== i) : [...mealCtx.addons, i]; el.classList.toggle('on'); el.querySelector('.plus').textContent = mealCtx.addons.includes(i) ? '✓' : '+'; refreshMealSheet(); buzz(5); break; }
    case 'fav': { const id = ds.id; S.favorites = S.favorites.includes(id) ? S.favorites.filter(x => x !== id) : [...S.favorites, id]; save(); el.textContent = S.favorites.includes(id) ? '❤️' : '🤍'; buzz(10); if (S.favorites.includes(id)) toast('❤️ Saved — it’ll show up more often'); break; }
    case 'meal-save': { const p = ensurePlan(mealCtx.k); p[mealCtx.slot] = { id: mealCtx.id, portion: mealCtx.portion, addons: mealCtx.addons }; save(); closeSheet(); render(); toast('Saved ✨'); break; }
    case 'meal-eat': {
      const p = ensurePlan(mealCtx.k); p[mealCtx.slot] = { id: mealCtx.id, portion: mealCtx.portion, addons: mealCtx.addons };
      logMealEntry(mealCtx.k, mealCtx.slot, mealById(mealCtx.id), mealCtx.portion, mealCtx.addons, mealCtx.slot);
      closeSheet(); buzz([10, 30, 10]); toast('Logged! 💛'); checkBadges(); render();
      if (SLOTS.every(s => planEntry(k, s.id))) setTimeout(() => confetti(), 300); break;
    }
    case 'meal-uneat': { const d = getDay(mealCtx.k); d.entries = d.entries.filter(e => e.planSlot !== mealCtx.slot); save(); closeSheet(); render(); break; }
    case 'meal-swap-in-sheet': if (mealCtx.mode === 'plan') openPicker(mealCtx.k, mealCtx.slot); break;
    case 'ate-else': {
      closeSheet(); const slot = ds.slot;
      setTimeout(() => { openQuickAdd(k, slot); qa.planSlot = slot; }, 360); break;
    }
    case 'view-meal': { const m = mealById(ds.id); openMealSheet({ k, slot: null, id: m.id, portion: 1, addons: [], mode: 'browse' }); $('#sheet').dataset.kind = 'meal'; break; }
    case 'plan-as': { setPlanMeal(k, ds.slot, mealCtx.id); const pl = ensurePlan(k)[ds.slot]; pl.portion = mealCtx.portion; pl.addons = mealCtx.addons; save(); closeSheet(); toast(`On today’s menu ✨`); ui.tab = 'home'; render(); break; }
    case 'browse-log': { const m = mealById(mealCtx.id), c = mealCalc(m, mealCtx.portion, mealCtx.addons); addEntry(k, { name: m.name, emoji: m.emoji, kcal: c.kcal, p: c.p, slot: slotByTime(), mealId: m.id, qty: mealCtx.portion }); closeSheet(); render(); break; }

    // --- picker ---
    case 'pick': setPlanMeal(ds.k, ds.slot, ds.id); buzz(10); closeSheet(); render(); toast('Swapped 🔄'); break;
    case 'pick-random': { const s = SLOTS.find(x => x.id === ds.slot), cur = ensurePlan(ds.k)[ds.slot].id; const pool = MEALS.filter(m => m.pools.includes(s.pool) && m.id !== cur); setPlanMeal(ds.k, ds.slot, pool[(Math.random() * pool.length) | 0].id); buzz(15); closeSheet(); render(); toast('🎲 Surprise!'); break; }
    case 'pick-tag': openPicker(ds.k, ds.slot, ds.v || null); break;

    // --- meals view filters ---
    case 'mf-pool': ui.mf.pool = ds.v; render(); break;
    case 'mf-tag': ui.mf.tag = ui.mf.tag === ds.v ? null : ds.v; render(); break;

    // --- quick add ---
    case 'qa-tab': qa.tab = ds.v; qa.sel = null; renderQuickAdd(); break;
    case 'qa-cat': qa.cat = ds.v; renderQuickAdd(); break;
    case 'qa-pick': qa.sel = Number(ds.i); qa.qty = 1; renderQuickAdd(); break;
    case 'qa-back': qa.sel = null; renderQuickAdd(); break;
    case 'qa-qty': qa.qty = Number(ds.v); renderQuickAdd(); break;
    case 'qa-slot': qa.slot = ds.v; $$('[data-action="qa-slot"]').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'qa-add-food': { const f = FOODS[qa.sel]; addEntry(qa.k, { name: f[0] + (f[1] ? ` (${f[1]})` : ''), emoji: f[4], kcal: r5(f[2] * qa.qty), p: Math.round(f[3] * qa.qty), slot: qa.slot, qty: qa.qty }); finishQA(); break; }
    case 'qa-add-custom': {
      const n = $('#cName').value.trim(), kc = Number($('#cKcal').value), pr = Number($('#cProt').value) || 0;
      if (!n || !kc) { toast('Add a name and calories 🙂'); break; }
      addEntry(qa.k, { name: n, emoji: '✏️', kcal: Math.round(kc), p: Math.round(pr), slot: qa.slot }); finishQA(); break;
    }
    case 'qa-recent': { const e = qa._recent[Number(ds.i)]; addEntry(qa.k, { name: e.name, emoji: e.emoji, kcal: e.kcal, p: e.p, slot: qa.slot, mealId: e.mealId }); finishQA(); break; }

    // --- calendar ---
    case 'cal-prev': ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() - 1, 1); render(); break;
    case 'cal-next': ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + 1, 1); render(); break;
    case 'open-day': openDaySheet(ds.k); $('#sheet').dataset.kind = 'day'; break;
    case 'day-add': closeSheet(); setTimeout(() => openQuickAdd(ds.k), 360); break;

    // --- weight ---
    case 'log-weight': openWeightSheet(); break;
    case 'w-step': { const i = $('#wIn'); i.value = r1(Number(i.value) + Number(ds.v)); buzz(5); break; }
    case 'w-save': {
      const v = r1(Number($('#wIn').value));
      if (!(v > 25 && v < 250)) { toast('Hmm, that number looks off'); break; }
      const prevMin = Math.min(...S.weights.map(w => w.kg));
      S.weights = S.weights.filter(w => w.date !== k); S.weights.push({ date: k, kg: v }); S.weights.sort((a, b) => a.date.localeCompare(b.date));
      save(); closeSheet(); checkBadges(); render();
      if (v < prevMin) { confetti(); toast(`New low! ${v} kg ✨ ירידה! כל הכבוד`); } else toast('Saved ⚖️ The trend is what matters');
      break;
    }
    case 'del-weight': if (S.weights.length > 1) { S.weights = S.weights.filter(w => w.date !== ds.k); save(); render(); } break;

    // --- exercise ---
    case 'ex-pick': exSel = Number(ds.i); openExerciseSheet(); break;
    case 'ex-save': { const x = EXERCISES[exSel]; getDay(k).exercise.push({ id: uid(), name: x[0], emoji: x[1], min: exMin, kcal: Math.round(x[2] * exMin * (currentWeight() / 55)) }); save(); closeSheet(); checkBadges(); render(); toast(`${x[1]} Nice! Extra food budget unlocked`); break; }

    // --- coach ---
    case 'ask': ask(ds.q); break;

    // --- settings ---
    case 'theme': S.settings.theme = ds.v; save(); document.documentElement.dataset.theme = ds.v; $$('.theme-dot').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'set-act': P().activity = Number(ds.v); save(); openSettings(); break;
    case 'set-pace': P().pace = ds.v; save(); openSettings(); break;
    case 'settings-save': {
      const p = P(), num = id => Number($(id).value);
      p.name = $('#sName').value.trim() || p.name; p.nameHe = $('#sNameHe').value.trim() || p.nameHe;
      if (num('#sH') > 120) p.heightCm = num('#sH'); if (num('#sAge') > 10) p.age = num('#sAge');
      if (num('#sSW') > 25) p.startWeight = r1(num('#sSW'));
      const gw = r1(num('#sGW'));
      if (gw < minHealthyWeight()) { toast(`Goal must be at least ${minHealthyWeight()} kg — healthy first 💛`); break; }
      p.goalWeight = gw;
      S.settings.waterGoal = clamp(num('#sWater') || 8, 4, 14);
      SLOTS.forEach(s => { const v = $('#t_' + s.id).value; if (v) S.settings.times[s.id] = v; });
      // re-fit portions of today's not-yet-eaten meals to the new budget
      const plan = ensurePlan(k); SLOTS.forEach(s => { if (!planEntry(k, s.id)) plan[s.id].portion = autoPortion(mealById(plan[s.id].id), s.id); });
      save(); scheduleReminders(); closeSheet(); render(); toast('Saved ✨'); break;
    }
    case 'notify-on': enableNotifications(); break;
    case 'ics': downloadICS(); break;
    case 'backup': downloadFile(`${CONFIG.id}-backup-${k}.json`, JSON.stringify(S), 'application/json'); toast('💾 Backup saved'); break;
    case 'restore': { const f = $('#restoreFile'); f.onchange = async () => { try { const data = JSON.parse(await f.files[0].text()); if (!data.profile) throw 0; S = data; save(); closeSheet(); render(); toast('Restored ✅'); } catch (e) { toast('That file didn’t work 😕'); } }; f.click(); break; }
    case 'reset': if (confirm('Delete ALL data and start over? This can’t be undone.')) { localStorage.removeItem(STORE_KEY); location.reload(); } break;
  }
}
function finishQA() {
  if (qa.planSlot) { // "ate something else" — mark the planned slot as handled by this entry
    const d = getDay(qa.k), e = d.entries[d.entries.length - 1];
    d.entries = d.entries.filter(x => x.planSlot !== qa.planSlot || x === e); e.planSlot = qa.planSlot; save();
  }
  closeSheet(); render();
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast(/iPhone|iPad/.test(navigator.userAgent) ? '📲 Add the app to your Home Screen first, then try again' : 'Notifications aren’t supported here — use the calendar option'); return; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications blocked — use the 📅 calendar option instead'); return; }
  S.settings.notify = true; save(); scheduleReminders();
  notify(`Hi ${P().name}! 🔔`, 'Meal reminders are on. I’ll ping you at meal times 💛');
  openSettings();
}

// =========================================================
//  BOOT
// =========================================================
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (ui.tab === 'home') render(); });

let lastHidden = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { lastHidden = Date.now(); return; }
  if (Date.now() - lastHidden > 20 * 60 * 1000) showSplash();   // welcome back after a break
  render(); scheduleReminders();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.documentElement.dataset.theme = S.settings.theme;
showSplash();
ensurePlan();
render();
scheduleReminders();
checkBadges();
