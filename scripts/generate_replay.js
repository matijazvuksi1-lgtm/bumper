/**
 * REAL replay generator (no browser LocalStorage)
 *
 * Runs in GitHub Actions (or locally) and writes:
 *  - replays/<YYYYMMDD-A|B>.json  (frames + summary)
 *  - replays/index.json           (latest first)
 *
 * The viewer (game.bundle.js) loads /replays/<id>.json and animates frames.
 */

const fs = require("fs");
const path = require("path");

// -----------------------------
// helpers
// -----------------------------
function pad2(n) { return String(n).padStart(2, "0"); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hypot(x, y) { return Math.hypot(x, y); }

function hash32(str) {
  // xmur3-ish
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tzParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour,
    minute: +map.minute,
    second: +map.second
  };
}

function make12hKey(now, tz = "Europe/Zagreb") {
  const p = tzParts(now, tz);
  const slot = (p.hour >= 6 && p.hour < 18) ? "A" : "B";
  // before 06:00 => previous day B
  let y = p.year, m = p.month, d = p.day;
  if (p.hour < 6) {
    const prev = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const q = tzParts(prev, tz);
    y = q.year; m = q.month; d = q.day;
  }
  return `${y}${pad2(m)}${pad2(d)}-${slot}`;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// -----------------------------
// config (mirrors your client config where it matters)
// -----------------------------
const CFG = {
  timezone: "Europe/Zagreb",
  players: 30,
  tickMs: 16,
  sampleEveryTicks: 2,
  maxTicks: 9000,

  // world
  worldW: 1200,
  worldH: 900,

  // physics
  friction: 0.9965,
  restitution: 0.985,
  pushApart: 0.95,

  // movement
  minSpeed: 2.3,
  maxSpeed: 5.2,

  // player
  baseHp: 100,

  // damage
  baseContactDamage: 2,
  impactDamageScale: 1.15,
  minImpactForDamage: 0.75,
  damageCooldownTicks: 8,

  // zone
  zone: {
    warmupTicks: 25,
    shrinkEveryTicks: 22,
    shrinkStep: 14,
    endRadius: 70,
    shiftMax: 180,
    moveDurationTicks: 45
  },

  // AI
  ai: {
    steerJitter: 0.10,
    steerForce: 0.060,
    zoneSteerBoost: 0.13,
    aggressive: { seekRange: 260, seekForce: 0.085, turnAssist: 0.08 },
    balanced: { seekRange: 200, seekForce: 0.060, seekChance: 0.20 },
    coward: { fleeHp: 35, fleeRange: 300, fleeForce: 0.10, turnAssist: 0.10 }
  },

  rarity: {
    tiers: [
      { name: "Common", weight: 35, hpMult: 1.00, speedMult: 1.00, dmgMult: 1.00, defMult: 1.00, massMult: 1.00, color: "#9aa0a6", icon: "⚪" },
      { name: "Uncommon", weight: 28, hpMult: 1.05, speedMult: 1.02, dmgMult: 1.04, defMult: 1.02, massMult: 1.02, color: "#34c759", icon: "🟢" },
      { name: "Rare", weight: 20, hpMult: 1.10, speedMult: 1.04, dmgMult: 1.08, defMult: 1.05, massMult: 1.03, color: "#0a84ff", icon: "🔵" },
      { name: "Epic", weight: 10, hpMult: 1.14, speedMult: 1.06, dmgMult: 1.12, defMult: 1.08, massMult: 1.04, color: "#bf5af2", icon: "🟣" },
      { name: "Legendary", weight: 7, hpMult: 1.18, speedMult: 1.08, dmgMult: 1.15, defMult: 1.12, massMult: 1.05, color: "#ffd60a", icon: "🟡" }
    ],
    guaranteedLegendary: 2
  }
};

// -----------------------------
// sim helpers
// -----------------------------
function pickRarity(rng, i, legendaryBudget) {
  // guarantee first N are legendary (simple + deterministic)
  if (i < CFG.rarity.guaranteedLegendary) return CFG.rarity.tiers.find(t => t.name === "Legendary");

  const total = CFG.rarity.tiers.reduce((s, t) => s + t.weight, 0);
  let roll = rng() * total;
  for (const t of CFG.rarity.tiers) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return CFG.rarity.tiers[0];
}

function pickPersonality(rng) {
  const r = rng();
  if (r < 0.34) return "aggressive";
  if (r < 0.78) return "balanced";
  return "coward";
}

function spawnPlayers(rng, zone) {
  const players = [];
  for (let i = 0; i < CFG.players; i++) {
    const rarity = pickRarity(rng, i);
    const personality = pickPersonality(rng);
    const angle = rng() * Math.PI * 2;
    const rad = (zone.r * 0.65) * Math.sqrt(rng());
    const x = zone.cx + Math.cos(angle) * rad;
    const y = zone.cy + Math.sin(angle) * rad;

    const hpMax = Math.round(CFG.baseHp * rarity.hpMult);
    const p = {
      id: i + 1,
      name: `BOT-${String(i + 1).padStart(2, "0")}`,
      x, y,
      vx: (rng() - 0.5) * 2,
      vy: (rng() - 0.5) * 2,
      hpMax,
      hp: hpMax,
      alive: true,
      kills: 0,
      dmgDealt: 0,
      dmgTaken: 0,
      hitFlash: 0,
      hitCd: 0,
      personality,
      rarity,
      speedMult: rarity.speedMult,
      dmgMult: rarity.dmgMult,
      defMult: rarity.defMult,
      mass: rarity.massMult,
    };
    players.push(p);
  }
  return players;
}

function newZone(rng) {
  return {
    cx: CFG.worldW / 2,
    cy: CFG.worldH / 2,
    r: 520,
    startR: 520,
    fromX: CFG.worldW / 2,
    fromY: CFG.worldH / 2,
    toX: CFG.worldW / 2,
    toY: CFG.worldH / 2,
    moveT: 1,
    moveStartTick: 0,
    nextShrinkTick: CFG.zone.warmupTicks
  };
}

function alivePlayers(players) {
  return players.filter(p => p.alive);
}

function closestTarget(me, players) {
  let best = null;
  let bestD2 = Infinity;
  for (const p of players) {
    if (!p.alive || p.id === me.id) continue;
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best;
}

function zoneVector(p, zone) {
  const dx = zone.cx - p.x;
  const dy = zone.cy - p.y;
  const d = Math.max(1e-6, hypot(dx, dy));
  return { dx: dx / d, dy: dy / d, dist: d };
}

function stepAI(p, players, zone, rng) {
  if (!p.alive) return { ax: 0, ay: 0 };
  const alive = alivePlayers(players);
  const zv = zoneVector(p, zone);
  const edge = zone.r - zv.dist;

  let ax = (rng() - 0.5) * CFG.ai.steerJitter;
  let ay = (rng() - 0.5) * CFG.ai.steerJitter;

  // zone pull (stronger near edge)
  const edgeBoost = clamp(1 - edge / 120, 0, 1) * CFG.ai.zoneSteerBoost;
  ax += zv.dx * edgeBoost;
  ay += zv.dy * edgeBoost;

  const target = closestTarget(p, players);
  if (!target) return { ax, ay };

  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.max(1e-6, hypot(dx, dy));
  const ux = dx / d, uy = dy / d;

  if (p.personality === "aggressive") {
    if (d < CFG.ai.aggressive.seekRange) {
      ax += ux * CFG.ai.aggressive.seekForce;
      ay += uy * CFG.ai.aggressive.seekForce;
    }
  } else if (p.personality === "balanced") {
    if (d < CFG.ai.balanced.seekRange && rng() < CFG.ai.balanced.seekChance) {
      ax += ux * CFG.ai.balanced.seekForce;
      ay += uy * CFG.ai.balanced.seekForce;
    }
  } else {
    // coward
    if (p.hp <= CFG.ai.coward.fleeHp && d < CFG.ai.coward.fleeRange) {
      ax -= ux * CFG.ai.coward.fleeForce;
      ay -= uy * CFG.ai.coward.fleeForce;
    }
  }

  return { ax, ay };
}

function capSpeed(p) {
  const v = hypot(p.vx, p.vy);
  const maxV = CFG.maxSpeed * (p.speedMult || 1);
  const minV = CFG.minSpeed * 0.25;
  if (v > maxV) {
    p.vx = (p.vx / v) * maxV;
    p.vy = (p.vy / v) * maxV;
  } else if (v < minV) {
    // tiny nudge to avoid dead stop
    const k = (minV / Math.max(1e-6, v));
    p.vx *= k;
    p.vy *= k;
  }
}

function stepZone(zone, tick, rng) {
  if (tick < CFG.zone.warmupTicks) return;
  if (tick < zone.nextShrinkTick) {
    // move zone center
    const t = clamp((tick - zone.moveStartTick) / CFG.zone.moveDurationTicks, 0, 1);
    zone.moveT = t;
    zone.cx = zone.fromX + (zone.toX - zone.fromX) * t;
    zone.cy = zone.fromY + (zone.toY - zone.fromY) * t;
    return;
  }

  // shrink
  zone.r = Math.max(CFG.zone.endRadius, zone.r - CFG.zone.shrinkStep);
  zone.nextShrinkTick += CFG.zone.shrinkEveryTicks;

  // pick new center target
  zone.fromX = zone.cx;
  zone.fromY = zone.cy;
  const ang = rng() * Math.PI * 2;
  const sh = rng() * CFG.zone.shiftMax;
  zone.toX = clamp(zone.cx + Math.cos(ang) * sh, 200, CFG.worldW - 200);
  zone.toY = clamp(zone.cy + Math.sin(ang) * sh, 160, CFG.worldH - 160);
  zone.moveStartTick = tick;
  zone.moveT = 0;
}

function pushBackIntoZone(p, zone) {
  const dx = p.x - zone.cx;
  const dy = p.y - zone.cy;
  const d = Math.max(1e-6, hypot(dx, dy));
  if (d <= zone.r) return;
  // project onto circle
  const ux = dx / d, uy = dy / d;
  p.x = zone.cx + ux * zone.r;
  p.y = zone.cy + uy * zone.r;
  // bounce inward
  const vn = p.vx * ux + p.vy * uy;
  p.vx -= (1 + CFG.restitution) * vn * ux;
  p.vy -= (1 + CFG.restitution) * vn * uy;
}

function resolveCollisions(players) {
  // simple circle collisions with soft push apart
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1e-6, hypot(dx, dy));
      const ra = 11 * (a.hp / (a.hpMax || 100));
      const rb = 11 * (b.hp / (b.hpMax || 100));
      const minD = ra + rb;
      if (d >= minD) continue;

      const ux = dx / d, uy = dy / d;
      const overlap = (minD - d) * CFG.pushApart;
      a.x -= ux * overlap * 0.5;
      a.y -= uy * overlap * 0.5;
      b.x += ux * overlap * 0.5;
      b.y += uy * overlap * 0.5;

      // velocity exchange (approx)
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const rel = rvx * ux + rvy * uy;
      if (rel > 0) continue;

      const invMassA = 1 / Math.max(0.25, a.mass || 1);
      const invMassB = 1 / Math.max(0.25, b.mass || 1);
      const jImpulse = -(1 + CFG.restitution) * rel / (invMassA + invMassB);
      a.vx -= (jImpulse * invMassA) * ux;
      a.vy -= (jImpulse * invMassA) * uy;
      b.vx += (jImpulse * invMassB) * ux;
      b.vy += (jImpulse * invMassB) * uy;

      // damage on hard impacts
      const impact = Math.abs(rel);
      if (impact >= CFG.minImpactForDamage) {
        if (a.hitCd <= 0) dealDamage(a, b, impact);
        if (b.hitCd <= 0) dealDamage(b, a, impact);
      }
    }
  }
}

function dealDamage(victim, attacker, impact) {
  const dmg = CFG.baseContactDamage * CFG.impactDamageScale * impact * (attacker.dmgMult || 1) / (victim.defMult || 1);
  const dealt = Math.max(1, Math.round(dmg));
  victim.hp -= dealt;
  victim.dmgTaken += dealt;
  attacker.dmgDealt += dealt;
  victim.hitFlash = 8;
  victim.hitCd = CFG.damageCooldownTicks;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    attacker.kills++;
  }
}

function stepTick(state) {
  const { rng, zone, players } = state;

  stepZone(zone, state.tick, rng);

  // AI + integrate
  for (const p of players) {
    if (!p.alive) continue;
    if (p.hitCd > 0) p.hitCd--;
    if (p.hitFlash > 0) p.hitFlash--;

    const a = stepAI(p, players, zone, rng);
    p.vx += a.ax;
    p.vy += a.ay;

    capSpeed(p);
    p.vx *= CFG.friction;
    p.vy *= CFG.friction;
    p.x += p.vx;
    p.y += p.vy;

    pushBackIntoZone(p, zone);
  }

  resolveCollisions(players);

  // zone damage (if outside after push/collisions)
  for (const p of players) {
    if (!p.alive) continue;
    const d = hypot(p.x - zone.cx, p.y - zone.cy);
    if (d > zone.r + 1) {
      p.hp -= 1;
      p.dmgTaken += 1;
      if (p.hp <= 0) { p.hp = 0; p.alive = false; }
    }
  }

  state.tick++;
}

function frameFromState(state) {
  return {
    tick: state.tick,
    zone: { cx: state.zone.cx, cy: state.zone.cy, r: state.zone.r },
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      hp: p.hp,
      hpMax: p.hpMax,
      alive: p.alive,
      kills: p.kills,
      dmgDealt: p.dmgDealt,
      dmgTaken: p.dmgTaken,
      hitFlash: p.hitFlash,
      personality: p.personality,
      rarity: p.rarity,
      speedMult: p.speedMult,
      dmgMult: p.dmgMult,
      defMult: p.defMult
    }))
  };
}

function pickWinner(players) {
  const alive = alivePlayers(players);
  if (alive.length === 1) return alive[0];
  // fallback: highest HP
  let best = players[0];
  for (const p of players) if (p.hp > best.hp) best = p;
  return best;
}

// -----------------------------
// main
// -----------------------------
const outDir = path.join(process.cwd(), "replays");
ensureDir(outDir);

const key = make12hKey(new Date(), CFG.timezone);
const createdAt = new Date().toISOString();
const seed = hash32(key);
const rng = mulberry32(seed);

const zone = newZone(rng);
const players = spawnPlayers(rng, zone);

const state = { tick: 0, rng, seed, zone, players };
const frames = [];

// capture initial
frames.push(frameFromState(state));

for (let t = 0; t < CFG.maxTicks; t++) {
  stepTick(state);
  if (state.tick % CFG.sampleEveryTicks === 0) {
    frames.push(frameFromState(state));
  }
  if (alivePlayers(players).length <= 1) break;
}

const winner = pickWinner(players);

const replay = {
  version: 1,
  id: key,
  createdAt,
  seed,
  summary: {
    winner: winner ? winner.name : "—",
    winnerId: winner ? winner.id : null,
    ticks: state.tick,
    frames: frames.length
  },
  frames
};

fs.writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify(replay));

// update index
const indexPath = path.join(outDir, "index.json");
let index = [];
try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch { index = []; }
if (!Array.isArray(index)) index = [];

index = [{ id: key, createdAt, winner: replay.summary.winner }, ...index]
  .filter((v, i, a) => a.findIndex(x => (x.id || x.key) === (v.id || v.key)) === i)
  .slice(0, 200);

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`Generated REAL replay ${key} with ${frames.length} frames. Winner: ${replay.summary.winner}`);
