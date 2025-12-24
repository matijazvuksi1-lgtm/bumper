// scripts/generate_replay.js
// REAL server-side match generator (same physics/damage as browser) -> saves /replays/<key>.json
// No LocalStorage. Everyone shares the same replays.

const fs = require("fs");
const path = require("path");

// ---------- helpers (copied from client) ----------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hypot(x, y) { return Math.hypot(x, y); }
function pad2(n) { return String(n).padStart(2, "0"); }

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getTzParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  const parts = fmt.formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  return { year: +out.year, month: +out.month, day: +out.day, hour: +out.hour, minute: +out.minute, second: +out.second };
}

// 12h key (A=06:00, B=18:00) in Zagreb
function make12hKey(date = new Date(), tz = "Europe/Zagreb") {
  const p = getTzParts(date, tz);
  const slot = (p.hour >= 6 && p.hour < 18) ? "A" : "B";
  return `${p.year}${pad2(p.month)}${pad2(p.day)}-${slot}`;
}
function dailySeedFromKey(key) { return hash32(String(key)); }

// ---------- CONFIG (matches game.config defaults you use) ----------
const GAME = {
  players: 30,
  tickMs: 16,
  subSteps: 2,

  friction: 0.9965,
  restitution: 0.985,
  pushApart: 0.95,

  minSpeed: 2.3,
  maxSpeed: 5.2,

  steerJitter: 0.10,
  steerForce: 0.060,
  zoneSteerBoost: 0.13,

  aggressive: { seekRange: 260, seekForce: 0.085 },
  balanced: { seekRange: 200, seekForce: 0.060, seekChance: 0.20 },
  coward: { fleeHp: 35, fleeForce: 0.10, fleeRange: 300 },

  baseRadius: 11,
  minRadiusScale: 0.70,
  maxRadiusScale: 1.45,
  massMin: 0.75,
  massMax: 1.55,

  baseContactDamage: 2,
  impactDamageScale: 1.15,
  minImpactForDamage: 0.75,
  damageCooldownTicks: 8,

  zoneWarmupTicks: 25,
  zoneShrinkEveryTicks: 22,
  zoneShrinkStep: 14,
  zoneEndRadius: 70,
  zoneShiftMax: 180,
  zoneMoveDurationTicks: 45,

  replaySampleEveryTicks: 2,
  replayMaxFrames: 9000,

  timezone: "Europe/Zagreb"
};

// ---------- BOT PROFILES (same fixed stats as your client bundle) ----------
const BOT_PROFILES = {
  1: { rarityName: "Epic", personality: "Balanced", speed: 63, dmg: 61, def: 80, hpStat: 85, hpMax: 180 },
  2: { rarityName: "Epic", personality: "Balanced", speed: 73, dmg: 79, def: 71, hpStat: 84, hpMax: 179 },
  3: { rarityName: "Common", personality: "Balanced", speed: 48, dmg: 63, def: 61, hpStat: 38, hpMax: 119 },
  4: { rarityName: "Legendary", personality: "Balanced", speed: 92, dmg: 73, def: 75, hpStat: 80, hpMax: 174 },
  5: { rarityName: "Epic", personality: "Survivor", speed: 56, dmg: 82, def: 75, hpStat: 72, hpMax: 164 },
  6: { rarityName: "Common", personality: "Aggressive", speed: 51, dmg: 65, def: 52, hpStat: 54, hpMax: 140 },
  7: { rarityName: "Epic", personality: "Aggressive", speed: 73, dmg: 71, def: 71, hpStat: 61, hpMax: 149 },
  8: { rarityName: "Rare", personality: "Balanced", speed: 75, dmg: 66, def: 62, hpStat: 73, hpMax: 165 },
  9: { rarityName: "Common", personality: "Balanced", speed: 65, dmg: 50, def: 53, hpStat: 56, hpMax: 144 },
  10:{ rarityName: "Uncommon", personality: "Balanced", speed: 58, dmg: 48, def: 53, hpStat: 55, hpMax: 143 },
  11:{ rarityName: "Rare", personality: "Survivor", speed: 68, dmg: 54, def: 74, hpStat: 68, hpMax: 158 },
  12:{ rarityName: "Uncommon", personality: "Aggressive", speed: 58, dmg: 66, def: 55, hpStat: 60, hpMax: 148 },
  13:{ rarityName: "Common", personality: "Balanced", speed: 45, dmg: 44, def: 44, hpStat: 47, hpMax: 131 },
  14:{ rarityName: "Rare", personality: "Aggressive", speed: 77, dmg: 71, def: 62, hpStat: 70, hpMax: 160 },
  15:{ rarityName: "Epic", personality: "Survivor", speed: 66, dmg: 69, def: 86, hpStat: 81, hpMax: 176 },
  16:{ rarityName: "Uncommon", personality: "Balanced", speed: 52, dmg: 56, def: 56, hpStat: 58, hpMax: 146 },
  17:{ rarityName: "Rare", personality: "Balanced", speed: 71, dmg: 66, def: 63, hpStat: 69, hpMax: 159 },
  18:{ rarityName: "Common", personality: "Aggressive", speed: 53, dmg: 58, def: 45, hpStat: 52, hpMax: 138 },
  19:{ rarityName: "Uncommon", personality: "Balanced", speed: 59, dmg: 55, def: 55, hpStat: 57, hpMax: 145 },
  20:{ rarityName: "Epic", personality: "Aggressive", speed: 74, dmg: 83, def: 70, hpStat: 75, hpMax: 168 },
  21:{ rarityName: "Legendary", personality: "Aggressive", speed: 90, dmg: 86, def: 74, hpStat: 88, hpMax: 186 },
  22:{ rarityName: "Uncommon", personality: "Survivor", speed: 54, dmg: 52, def: 62, hpStat: 60, hpMax: 148 },
  23:{ rarityName: "Rare", personality: "Balanced", speed: 70, dmg: 60, def: 66, hpStat: 70, hpMax: 160 },
  24:{ rarityName: "Epic", personality: "Balanced", speed: 79, dmg: 72, def: 71, hpStat: 78, hpMax: 172 },
  25:{ rarityName: "Legendary", personality: "Survivor", speed: 88, dmg: 74, def: 89, hpStat: 92, hpMax: 192 },
  26:{ rarityName: "Uncommon", personality: "Aggressive", speed: 62, dmg: 64, def: 51, hpStat: 63, hpMax: 151 },
  27:{ rarityName: "Rare", personality: "Aggressive", speed: 60, dmg: 73, def: 64, hpStat: 64, hpMax: 153 },
  28:{ rarityName: "Common", personality: "Balanced", speed: 44, dmg: 40, def: 49, hpStat: 48, hpMax: 132 },
  29:{ rarityName: "Rare", personality: "Balanced", speed: 72, dmg: 67, def: 47, hpStat: 75, hpMax: 168 },
  30:{ rarityName: "Common", personality: "Aggressive", speed: 43, dmg: 52, def: 37, hpStat: 54, hpMax: 140 },
};

// rarity tiers (icons/colors)
const TIERS = [
  { name: "Common",    weight: 35, hpMult: 1.00, speedMult: 1.00, dmgMult: 1.00, defMult: 1.00, massMult: 1.00, icon: "⚪" },
  { name: "Uncommon",  weight: 28, hpMult: 1.05, speedMult: 1.02, dmgMult: 1.04, defMult: 1.02, massMult: 1.02, icon: "🟢" },
  { name: "Rare",      weight: 20, hpMult: 1.10, speedMult: 1.04, dmgMult: 1.08, defMult: 1.05, massMult: 1.03, icon: "🔵" },
  { name: "Epic",      weight: 10, hpMult: 1.14, speedMult: 1.06, dmgMult: 1.12, defMult: 1.08, massMult: 1.04, icon: "🟣" },
  { name: "Legendary", weight: 7,  hpMult: 1.18, speedMult: 1.08, dmgMult: 1.15, defMult: 1.12, massMult: 1.05, icon: "🟡" }
];
function getTierByName(name) { return TIERS.find(t => t.name === name) || TIERS[0]; }

// ---------- world size (Node) ----------
const WORLD = { w: 1200, h: 800 };

// ---------- zone ----------
function newZone(rng) {
  const baseR = Math.min(WORLD.w, WORLD.h) * 0.43;
  const startR = Math.max(280, Math.min(520, Math.floor(baseR)));
  const cx = WORLD.w * 0.5 + (rng() - 0.5) * 30;
  const cy = WORLD.h * 0.5 + (rng() - 0.5) * 30;
  return { cx, cy, r: startR, startR, fromX: cx, fromY: cy, toX: cx, toY: cy, moveT: 1, moveStartTick: 0 };
}
function scheduleZoneMove(zone, rng, tick) {
  zone.fromX = zone.cx; zone.fromY = zone.cy;
  const ang = rng() * Math.PI * 2;
  const mag = rng() * GAME.zoneShiftMax;
  const tx = zone.cx + Math.cos(ang) * mag;
  const ty = zone.cy + Math.sin(ang) * mag;
  const pad = Math.max(40, zone.r + 20);
  zone.toX = clamp(tx, pad, WORLD.w - pad);
  zone.toY = clamp(ty, pad, WORLD.h - pad);
  zone.moveT = 0;
  zone.moveStartTick = tick;
}
function updateZone(zone, tick) {
  if (zone.moveT < 1) {
    const t = clamp((tick - zone.moveStartTick) / GAME.zoneMoveDurationTicks, 0, 1);
    zone.moveT = t;
    const s = t * t * (3 - 2 * t);
    zone.cx = lerp(zone.fromX, zone.toX, s);
    zone.cy = lerp(zone.fromY, zone.toY, s);
  }
}

// ---------- sizing ----------
function hpToScale(hp, hpMax = 100) {
  const t = clamp(hpMax ? (hp / hpMax) : 0, 0, 1);
  const s = t * t * (3 - 2 * t);
  return lerp(GAME.minRadiusScale, GAME.maxRadiusScale, s);
}
function radiusOf(p) { return GAME.baseRadius * hpToScale(p.hp, p.hpMax || 100); }

// ---------- player creation ----------
function clampMult(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function jitterByRarityName(name) {
  if (name === "Legendary") return 0.035;
  if (name === "Epic") return 0.045;
  if (name === "Rare") return 0.055;
  if (name === "Uncommon") return 0.060;
  return 0.065;
}
function applyRarityToPlayer(p, rarity, rng) {
  p.rarity = rarity;
  const j = jitterByRarityName(rarity.name);
  const jmul = () => (1 + (rng() - 0.5) * 2 * j);
  p.speedMult = clampMult((rarity.speedMult || 1) * jmul(), 0.80, 1.60);
  p.dmgMult   = clampMult((rarity.dmgMult   || 1) * jmul(), 0.80, 1.80);
  p.defMult   = clampMult((rarity.defMult   || 1) * jmul(), 0.80, 1.80);
  p.hpMax = Math.max(1, Math.round(100 * (rarity.hpMult || 1) * jmul()));
  p.hp = Math.min(p.hp, p.hpMax);
}
function createPlayer(id, rng, zone) {
  const prof = BOT_PROFILES[id] || BOT_PROFILES[1];
  const rarity = getTierByName(prof.rarityName);

  const massBase = lerp(GAME.massMin, GAME.massMax, rng());
  const ang = rng() * Math.PI * 2;
  const rad = rng() * (zone.r - 80);
  const x = zone.cx + Math.cos(ang) * rad;
  const y = zone.cy + Math.sin(ang) * rad;

  const dir = rng() * Math.PI * 2;
  const sp = lerp(GAME.minSpeed, GAME.maxSpeed, rng());

  const p = {
    id,
    name: `P${String(id).padStart(2, "0")}`,
    personality: prof.personality,
    rarity,
    speedMult: 1, dmgMult: 1, defMult: 1,
    hpMax: prof.hpMax || 100,
    x, y,
    vx: Math.cos(dir) * sp,
    vy: Math.sin(dir) * sp,
    dir,
    massBase,
    mass: massBase,
    invMass: 1 / massBase,
    hp: prof.hpMax || 100,
    alive: true,
    hitCd: 0,
    hitFlash: 0,
    kills: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    targetId: null,
    speedStat: prof.speed,
    dmgStat: prof.dmg,
    defStat: prof.def,
    hpStat: prof.hpStat
  };

  p.mass = p.massBase * clampMult(rarity.massMult || 1, 0.8, 1.4);
  p.invMass = 1 / p.mass;
  return p;
}

// ---------- combat / collisions ----------
function eliminate(victim, killerName, events, tick) {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  victim.vx = victim.vy = 0;
  events.push({ tick, type: "kill", victim: victim.name, killer: killerName || null });
}
function contactDamage(a, b, impact, nx, ny, events, tick) {
  if (impact < GAME.minImpactForDamage) return;
  const base = Math.max(1, Math.floor(GAME.baseContactDamage + impact * GAME.impactDamageScale));

  const apply = (victim, attacker) => {
    if (!victim.alive || !attacker.alive) return;
    if (victim.hitCd !== 0) return;

    const atkT = clamp((attacker.dmgStat ?? 50) / 100, 0, 1);
    const defT = clamp((victim.defStat ?? 50) / 100, 0, 1);
    const atkF = lerp(0.75, 1.55, atkT) * (attacker.dmgMult || 1);
    const defF = lerp(0.75, 1.60, defT) * (victim.defMult || 1);
    const dmg = Math.max(1, Math.floor((base * atkF) / defF));

    victim.hp -= dmg;
    attacker.dmgDealt += dmg;
    victim.dmgTaken += dmg;
    victim.hitCd = GAME.damageCooldownTicks;
    victim.hitFlash = 8;

    events.push({ tick, type: "hit", attacker: attacker.name, victim: victim.name, dmg });

    if (victim.hp <= 0) {
      eliminate(victim, attacker.name, events, tick);
      attacker.kills++;
    }
  };

  apply(a, b);
  apply(b, a);
}
function bounceOffZone(state, p) {
  const z = state.zone;
  const r = radiusOf(p);
  const dx = p.x - z.cx, dy = p.y - z.cy;
  const d = hypot(dx, dy) || 1;
  const limit = z.r - r;
  if (d <= limit) return;
  const nx = dx / d, ny = dy / d;

  p.x = z.cx + nx * limit;
  p.y = z.cy + ny * limit;

  const dot = p.vx * nx + p.vy * ny;
  p.vx = (p.vx - 2 * dot * nx) * GAME.restitution;
  p.vy = (p.vy - 2 * dot * ny) * GAME.restitution;
}
function collidePlayers(a, b, events, tick) {
  if (!a.alive || !b.alive) return;

  const ra = radiusOf(a);
  const rb = radiusOf(b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const minDist = ra + rb;
  if (dist >= minDist) return;

  const nx = dx / dist;
  const ny = dy / dist;

  const overlap = minDist - dist;
  const invSum = a.invMass + b.invMass;

  const ax = nx * overlap * (a.invMass / invSum) * GAME.pushApart;
  const ay = ny * overlap * (a.invMass / invSum) * GAME.pushApart;
  const bx = nx * overlap * (b.invMass / invSum) * GAME.pushApart;
  const by = ny * overlap * (b.invMass / invSum) * GAME.pushApart;

  a.x -= ax; a.y -= ay;
  b.x += bx; b.y += by;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return;

  const j = -(1 + GAME.restitution) * velAlongNormal / invSum;
  const impX = j * nx;
  const impY = j * ny;

  a.vx -= impX * a.invMass;
  a.vy -= impY * a.invMass;
  b.vx += impX * b.invMass;
  b.vy += impY * b.invMass;

  contactDamage(a, b, Math.abs(velAlongNormal), nx, ny, events, tick);
}

// ---------- AI ----------
function findNearestAliveEnemy(state, p, maxRange) {
  let best = null;
  let bestD = maxRange * maxRange;
  for (const q of state.players) {
    if (!q.alive || q.id === p.id) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = q; }
  }
  return best;
}
function aiSteer(state, p) {
  p.dir += (state.rng() - 0.5) * 2 * GAME.steerJitter;

  const z = state.zone;
  const dxz = p.x - z.cx, dyz = p.y - z.cy;
  const dz = Math.hypot(dxz, dyz) || 1;
  const edgeT = clamp((dz - (z.r * 0.75)) / (z.r * 0.25), 0, 1);
  if (edgeT > 0) {
    const toward = Math.atan2(z.cy - p.y, z.cx - p.x);
    const blend = GAME.zoneSteerBoost * edgeT;
    let delta = toward - p.dir;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    p.dir += delta * blend;
  }

  if (p.personality === "Aggressive") {
    const cfg = GAME.aggressive;
    const target = findNearestAliveEnemy(state, p, cfg.seekRange);
    if (target) {
      const ang = Math.atan2(target.y - p.y, target.x - p.x);
      let delta = ang - p.dir;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      p.dir += delta * 0.08;
      p.vx += Math.cos(ang) * cfg.seekForce;
      p.vy += Math.sin(ang) * cfg.seekForce;
    }
  } else if (p.personality === "Survivor") {
    const cfg = GAME.coward;
    let alive = 0;
    for (const q of state.players) if (q.alive) alive++;

    if (p.hp <= cfg.fleeHp) {
      const threat = findNearestAliveEnemy(state, p, cfg.fleeRange);
      if (threat) {
        const angAway = Math.atan2(p.y - threat.y, p.x - threat.x);
        let delta = angAway - p.dir;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        p.dir += delta * 0.10;
        p.vx += Math.cos(angAway) * cfg.fleeForce;
        p.vy += Math.sin(angAway) * cfg.fleeForce;
      }
    } else {
      const bcfg = GAME.balanced;
      const prob = (alive <= 6) ? 0.35 : 0.18;
      const forceMul = (alive <= 6) ? 0.85 : 0.45;

      if (state.rng() < prob) {
        const target = findNearestAliveEnemy(state, p, bcfg.seekRange);
        if (target) {
          const ang = Math.atan2(target.y - p.y, target.x - p.x);
          p.vx += Math.cos(ang) * bcfg.seekForce * forceMul;
          p.vy += Math.sin(ang) * bcfg.seekForce * forceMul;
        }
      }
    }
  } else {
    const cfg = GAME.balanced;
    if (state.rng() < (cfg.seekChance ?? 0.20)) {
      const target = findNearestAliveEnemy(state, p, cfg.seekRange);
      if (target) {
        const ang = Math.atan2(target.y - p.y, target.x - p.x);
        p.vx += Math.cos(ang) * cfg.seekForce * 0.55;
        p.vy += Math.sin(ang) * cfg.seekForce * 0.55;
      }
    }
  }

  p.vx += Math.cos(p.dir) * GAME.steerForce;
  p.vy += Math.sin(p.dir) * GAME.steerForce;
}
function clampSpeed(p) {
  const curSp = Math.hypot(p.vx, p.vy) || 1;
  const maxSp = GAME.maxSpeed * (p.speedMult || 1);
  const minSp = GAME.minSpeed * (p.speedMult || 1);
  const clamped = Math.max(minSp, Math.min(maxSp, curSp));
  p.vx = (p.vx / curSp) * clamped;
  p.vy = (p.vy / curSp) * clamped;
}

// ---------- match tick ----------
function tickMatch(state, events) {
  if (state.tick >= GAME.zoneWarmupTicks && (state.tick % GAME.zoneShrinkEveryTicks === 0)) {
    state.zone.r = Math.max(GAME.zoneEndRadius, state.zone.r - GAME.zoneShrinkStep);
    scheduleZoneMove(state.zone, state.rng, state.tick);
  }
  updateZone(state.zone, state.tick);

  for (let sub = 0; sub < GAME.subSteps; sub++) {
    for (const p of state.players) {
      if (!p.alive) continue;
      if (p.hitCd) p.hitCd--;
      if (p.hitFlash) p.hitFlash--;

      aiSteer(state, p);
      p.vx *= GAME.friction;
      p.vy *= GAME.friction;

      clampSpeed(p);
      p.x += p.vx;
      p.y += p.vy;

      bounceOffZone(state, p);
    }

    for (let i = 0; i < state.players.length; i++) {
      const a = state.players[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < state.players.length; j++) {
        const b = state.players[j];
        if (!b.alive) continue;
        collidePlayers(a, b, events, state.tick);
      }
    }
  }

  let alive = 0;
  let last = null;
  for (const p of state.players) if (p.alive) { alive++; last = p; }
  if (alive <= 1) {
    state.finished = true;
    state.winner = last ? last.name : "—";
  }

  state.tick++;
}

// ---------- replay capture ----------
function beginReplayCapture(state) {
  return {
    version: 2,
    startedAt: new Date().toISOString(),
    dailyKey: state.dailyKey,
    seed: state.seed,
    frames: [],
    events: [],
    summary: null
  };
}
function captureReplayFrame(cap, state) {
  if (state.tick % GAME.replaySampleEveryTicks !== 0) return;
  if (cap.frames.length >= GAME.replayMaxFrames) return;

  cap.frames.push({
    tick: state.tick,
    zone: { cx: state.zone.cx, cy: state.zone.cy, r: state.zone.r },
    players: state.players.map(p => ({
      id: p.id, name: p.name,
      alive: p.alive, hp: p.hp,
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, dir: p.dir,
      hitFlash: p.hitFlash,
      kills: p.kills, dmgDealt: p.dmgDealt, dmgTaken: p.dmgTaken,
      personality: p.personality,
      rarity: p.rarity,
      hpMax: p.hpMax,
      speedMult: p.speedMult,
      dmgMult: p.dmgMult,
      defMult: p.defMult,
      speedStat: p.speedStat,
      dmgStat: p.dmgStat,
      defStat: p.defStat,
      hpStat: p.hpStat
    }))
  });
}
function finalizeReplay(cap, state) {
  cap.finishedAt = new Date().toISOString();
  cap.summary = {
    winner: state.winner,
    dailyKey: state.dailyKey,
    seed: state.seed,
    durationTicks: state.tick
  };
}

// ---------- main ----------
function run() {
  const key = make12hKey(new Date(), GAME.timezone);
  const seed = dailySeedFromKey(key);
  const rng = mulberry32(seed);

  const zone = newZone(rng);
  const players = [];
  for (let i = 1; i <= GAME.players; i++) players.push(createPlayer(i, rng, zone));

  for (const p of players) {
    applyRarityToPlayer(p, p.rarity, rng);
    clampSpeed(p);
  }

  const state = { mode: "LIVE", dailyKey: key, seed, rng, tick: 0, zone, players, finished: false, winner: null };

  const cap = beginReplayCapture(state);

  const MAX_TICKS = 20000;
  while (!state.finished && state.tick < MAX_TICKS) {
    const events = [];
    tickMatch(state, events);
    for (const e of events) cap.events.push(e);
    captureReplayFrame(cap, state);
  }

  finalizeReplay(cap, state);

  const outDir = path.join(process.cwd(), "replays");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify(cap));

  const indexPath = path.join(outDir, "index.json");
  let index = [];
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch { index = []; }
  }
  index = [{ id: key, createdAt: cap.finishedAt, winner: cap.summary.winner }, ...index.filter(x => x.id !== key)].slice(0, 60);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  console.log("✅ Generated REAL replay:", key, "winner:", cap.summary.winner, "frames:", cap.frames.length, "events:", cap.events.length);
}

run();
