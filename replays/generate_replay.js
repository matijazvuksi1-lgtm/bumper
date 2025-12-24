// scripts/generate_replay.js
// REAL server-side replay generator (frames + collisions + damage + kills)
// + UNIQUE id every run: YYYYMMDD-A-001, -002 ... (Zagreb time, DST-safe)

const fs = require("fs");
const path = require("path");

// ---------------- helpers ----------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function pad(n, w = 2) { return String(n).padStart(w, "0"); }

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function writeJson(p, obj, pretty = false) {
  fs.writeFileSync(p, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}

// Zagreb 12h base key: YYYYMMDD-A (06:00–17:59) or YYYYMMDD-B (18:00–05:59)
function base12hKeyZagreb() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zagreb",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const y = parts.year;
  const m = parts.month;
  const day = parts.day;
  const h = Number(parts.hour);
  const slot = (h >= 6 && h < 18) ? "A" : "B";
  return `${y}${m}${day}-${slot}`;
}

// Unique key per run: YYYYMMDD-A-001, -002 ...
function makeUniqueKey(outDir) {
  const base = base12hKeyZagreb();
  const counterPath = path.join(outDir, "_counter.json");
  const counter = readJsonSafe(counterPath, {});
  const next = (counter[base] || 0) + 1;
  counter[base] = next;
  writeJson(counterPath, counter, true);
  return `${base}-${pad(next, 3)}`;
}

// ---------------- "same-feel" physics knobs ----------------
// Keep these aligned with your game config feel.
// (If you want EXACT, paste your client constants and I will mirror them 1:1.)
const CFG = {
  world: { w: 1400, h: 900 },
  tickHz: 60,
  ticks: 60 * 90,           // 90s match
  friction: 0.9965,
  restitution: 0.985,
  pushApart: 0.95,

  player: {
    baseRadius: 11,
    minRadiusScale: 0.70,
    maxRadiusScale: 1.45,
    massMin: 0.75,
    massMax: 1.55,
    hpBase: 100
  },

  motion: { minSpeed: 2.3, maxSpeed: 5.2 },

  damage: {
    baseContactDamage: 2,
    impactDamageScale: 1.15,
    minImpactForDamage: 0.75,
    cooldownTicks: 8
  },

  zone: {
    cx: 700,
    cy: 450,
    rStart: 560,
    rEnd: 130,
    warmupTicks: 25 * 10,        // ~10s
    shrinkEveryTicks: 22 * 10,   // ~22s
    shrinkStep: 14,              // px
    shiftMax: 180,
    moveDurationTicks: 45 * 2
  },

  replay: { sampleEveryTicks: 2 } // record every N ticks
};

function radiusOf(p) {
  const t = clamp(p.hp / p.hpMax, 0, 1);
  const s = t * t * (3 - 2 * t); // smoothstep
  const scale = CFG.player.minRadiusScale + (CFG.player.maxRadiusScale - CFG.player.minRadiusScale) * s;
  return CFG.player.baseRadius * scale;
}

// ---------------- simulation core ----------------
function rnd(a, b) { return a + Math.random() * (b - a); }
function hypot(x, y) { return Math.hypot(x, y); }

function makePlayers(n = 30) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const mass = rnd(CFG.player.massMin, CFG.player.massMax);
    arr.push({
      id: i + 1,
      x: rnd(150, CFG.world.w - 150),
      y: rnd(150, CFG.world.h - 150),
      vx: rnd(-1, 1) * CFG.motion.minSpeed,
      vy: rnd(-1, 1) * CFG.motion.minSpeed,
      hpMax: CFG.player.hpBase,
      hp: CFG.player.hpBase,
      mass,
      alive: true,
      kills: 0,
      dmgCd: 0
    });
  }
  return arr;
}

function steerAI(p, zone) {
  // Simple “bumper” behavior:
  // - random jitter
  // - slight bias toward zone center
  const jitter = 0.10;
  const steerForce = 0.060;

  const ax = (Math.random() - 0.5) * jitter;
  const ay = (Math.random() - 0.5) * jitter;

  const dx = zone.cx - p.x;
  const dy = zone.cy - p.y;
  const d = hypot(dx, dy) || 1;

  const toCenterX = dx / d;
  const toCenterY = dy / d;

  p.vx += (ax + toCenterX * 0.08) * (steerForce * 10);
  p.vy += (ay + toCenterY * 0.08) * (steerForce * 10);
}

function capSpeed(p) {
  const sp = hypot(p.vx, p.vy) || 1;
  const max = CFG.motion.maxSpeed;
  const min = CFG.motion.minSpeed;

  if (sp > max) {
    p.vx = (p.vx / sp) * max;
    p.vy = (p.vy / sp) * max;
  } else if (sp < min) {
    p.vx = (p.vx / sp) * min;
    p.vy = (p.vy / sp) * min;
  }
}

function applyFriction(p) {
  p.vx *= CFG.friction;
  p.vy *= CFG.friction;
}

// Zone shrinking + shifting (same “feel”)
function updateZone(zone, tick) {
  // shrink
  if (tick > CFG.zone.warmupTicks && tick % CFG.zone.shrinkEveryTicks === 0 && zone.r > CFG.zone.rEnd) {
    zone.r = Math.max(CFG.zone.rEnd, zone.r - CFG.zone.shrinkStep);

    // start a “move” to a new center
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * CFG.zone.shiftMax;
    zone.move = {
      fromCx: zone.cx,
      fromCy: zone.cy,
      toCx: clamp(zone.cx + Math.cos(ang) * dist, 200, CFG.world.w - 200),
      toCy: clamp(zone.cy + Math.sin(ang) * dist, 200, CFG.world.h - 200),
      t0: tick,
      dur: CFG.zone.moveDurationTicks
    };
  }

  // move center
  if (zone.move) {
    const t = (tick - zone.move.t0) / zone.move.dur;
    if (t >= 1) {
      zone.cx = zone.move.toCx;
      zone.cy = zone.move.toCy;
      zone.move = null;
    } else {
      const tt = clamp(t, 0, 1);
      zone.cx = zone.move.fromCx + (zone.move.toCx - zone.move.fromCx) * tt;
      zone.cy = zone.move.fromCy + (zone.move.toCy - zone.move.fromCy) * tt;
    }
  }
}

function bounceOffZone(p, zone) {
  const r = radiusOf(p);
  const dx = p.x - zone.cx;
  const dy = p.y - zone.cy;
  const d = hypot(dx, dy) || 0.0001;

  if (d > zone.r - r) {
    const nx = dx / d;
    const ny = dy / d;

    // clamp to boundary
    p.x = zone.cx + nx * (zone.r - r);
    p.y = zone.cy + ny * (zone.r - r);

    // reflect velocity
    const dot = p.vx * nx + p.vy * ny;
    p.vx -= 2 * dot * nx;
    p.vy -= 2 * dot * ny;

    // lose a tiny energy (feel)
    p.vx *= 0.995;
    p.vy *= 0.995;
  }
}

function collidePlayers(a, b, events, tick) {
  if (!a.alive || !b.alive) return;

  const ra = radiusOf(a);
  const rb = radiusOf(b);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = hypot(dx, dy) || 0.0001;
  const minDist = ra + rb;

  if (dist >= minDist) return;

  const nx = dx / dist;
  const ny = dy / dist;

  // push apart
  const overlap = minDist - dist;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const invSum = invA + invB;

  a.x -= nx * overlap * (invA / invSum) * CFG.pushApart;
  a.y -= ny * overlap * (invA / invSum) * CFG.pushApart;
  b.x += nx * overlap * (invB / invSum) * CFG.pushApart;
  b.y += ny * overlap * (invB / invSum) * CFG.pushApart;

  // bounce impulse
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal > 0) return;

  const j = -(1 + CFG.restitution) * velAlongNormal / invSum;

  a.vx -= j * invA * nx;
  a.vy -= j * invA * ny;
  b.vx += j * invB * nx;
  b.vy += j * invB * ny;

  // damage on impact (cooldown so it feels like original)
  const impact = Math.abs(velAlongNormal);
  const dmgBase = CFG.damage.baseContactDamage;
  const dmg = (impact >= CFG.damage.minImpactForDamage)
    ? Math.round((dmgBase + impact * CFG.damage.impactDamageScale) * 10) / 10
    : 0;

  if (dmg > 0) {
    if (a.dmgCd <= 0) {
      a.hp = Math.max(0, a.hp - dmg);
      a.dmgCd = CFG.damage.cooldownTicks;
      events.push({ type: "hit", tick, from: b.id, to: a.id, dmg });
    }
    if (b.dmgCd <= 0) {
      b.hp = Math.max(0, b.hp - dmg);
      b.dmgCd = CFG.damage.cooldownTicks;
      events.push({ type: "hit", tick, from: a.id, to: b.id, dmg });
    }
  }

  // deaths + kills
  if (a.alive && a.hp <= 0) {
    a.alive = false;
    b.kills++;
    events.push({ type: "kill", tick, killer: b.id, dead: a.id });
  }
  if (b.alive && b.hp <= 0) {
    b.alive = false;
    a.kills++;
    events.push({ type: "kill", tick, killer: a.id, dead: b.id });
  }
}

function resolveAllCollisions(players, events, tick) {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.alive) continue;
      collidePlayers(a, b, events, tick);
    }
  }
}

function aliveCount(players) {
  let c = 0;
  for (const p of players) if (p.alive) c++;
  return c;
}

function runMatch() {
  const players = makePlayers(30);
  const zone = { cx: CFG.zone.cx, cy: CFG.zone.cy, r: CFG.zone.rStart, move: null };

  const frames = [];
  const events = [];
  let winnerId = null;

  for (let tick = 0; tick < CFG.ticks; tick++) {
    updateZone(zone, tick);

    for (const p of players) {
      if (!p.alive) continue;

      if (p.dmgCd > 0) p.dmgCd--;

      steerAI(p, zone);
      capSpeed(p);
      applyFriction(p);

      // integrate
      p.x += p.vx;
      p.y += p.vy;

      // world clamp (soft)
      p.x = clamp(p.x, 0, CFG.world.w);
      p.y = clamp(p.y, 0, CFG.world.h);

      bounceOffZone(p, zone);
    }

    // IMPORTANT: bot-bot collisions + damage/kills
    resolveAllCollisions(players, events, tick);

    // record frame
    if (tick % CFG.replay.sampleEveryTicks === 0) {
      frames.push({
        tick,
        zone: { cx: zone.cx, cy: zone.cy, r: zone.r },
        players: players.map(p => ({
          id: p.id,
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          hp: p.hp,
          hpMax: p.hpMax,
          alive: p.alive,
          kills: p.kills
        }))
      });
    }

    // winner check
    const alive = players.filter(p => p.alive);
    if (alive.length === 1) {
      winnerId = alive[0].id;
      break;
    }
  }

  if (!winnerId) {
    // fallback winner: highest hp among alive
    const alive = players.filter(p => p.alive);
    if (alive.length) {
      alive.sort((a, b) => b.hp - a.hp);
      winnerId = alive[0].id;
    } else {
      winnerId = 1;
    }
  }

  const winner = `P${pad(winnerId, 2)}`;
  const summary = {
    winner,
    winnerId,
    aliveEnd: aliveCount(players),
    totalFrames: frames.length,
    totalEvents: events.length
  };

  return { frames, events, summary };
}

// ---------------- write replay files ----------------
const outDir = path.join(process.cwd(), "replays");
fs.mkdirSync(outDir, { recursive: true });

const id = makeUniqueKey(outDir);
const createdAt = new Date().toISOString();

const { frames, events, summary } = runMatch();

const replay = {
  version: 2,
  id,
  createdAt,
  config: {
    tickHz: CFG.tickHz,
    sampleEveryTicks: CFG.replay.sampleEveryTicks,
    world: CFG.world
  },
  summary,
  events,
  frames
};

// Save replay json
writeJson(path.join(outDir, `${id}.json`), replay, false);

// Update index.json (list)
const indexPath = path.join(outDir, "index.json");
let index = readJsonSafe(indexPath, []);
index = [
  { id, createdAt, winner: summary.winner },
  ...index.filter(e => e.id !== id)
].slice(0, 80);

writeJson(indexPath, index, true);

console.log("✅ Generated replay:", id, "frames:", frames.length, "events:", events.length);
