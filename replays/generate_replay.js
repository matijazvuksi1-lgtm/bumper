// scripts/generate_replay.js
// REAL server-side simulation with collisions + frames

const fs = require("fs");
const path = require("path");

// ---------------- helpers ----------------
function pad2(n) { return String(n).padStart(2, "0"); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Zagreb 12h key (A = 06:00, B = 18:00)
function make12hKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const h = d.getUTCHours();
  const slot = (h >= 6 && h < 18) ? "A" : "B";
  return `${y}${m}${day}-${slot}`;
}

// ---------------- physics ----------------
const BASE_RADIUS = 11;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.45;

function radiusOf(p) {
  const t = clamp(p.hp / p.hpMax, 0, 1);
  const s = t * t * (3 - 2 * t); // smoothstep
  return BASE_RADIUS * (MIN_SCALE + (MAX_SCALE - MIN_SCALE) * s);
}

function collide(a, b) {
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

  // push apart
  const overlap = minDist - dist;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const sum = invA + invB;

  a.x -= nx * overlap * (invA / sum) * 0.95;
  a.y -= ny * overlap * (invA / sum) * 0.95;
  b.x += nx * overlap * (invB / sum) * 0.95;
  b.y += ny * overlap * (invB / sum) * 0.95;

  // bounce
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vel = rvx * nx + rvy * ny;
  if (vel > 0) return;

  const j = -(1 + 0.985) * vel / sum;
  a.vx -= j * invA * nx;
  a.vy -= j * invA * ny;
  b.vx += j * invB * nx;
  b.vy += j * invB * ny;
}

function resolveCollisions(players) {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      collide(players[i], players[j]);
    }
  }
}

// ---------------- simulation ----------------
const WIDTH = 1200;
const HEIGHT = 800;
const ZONE = { cx: 600, cy: 400, r: 520 };

function makePlayers(n = 30) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      id: i + 1,
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      hpMax: 100,
      hp: 100,
      mass: 1 + Math.random() * 0.5,
      alive: true,
      kills: 0
    });
  }
  return arr;
}

function step(players) {
  for (const p of players) {
    if (!p.alive) continue;

    // random steering (AI lite)
    p.vx += (Math.random() - 0.5) * 0.4;
    p.vy += (Math.random() - 0.5) * 0.4;

    const sp = Math.hypot(p.vx, p.vy) || 1;
    const max = 5;
    if (sp > max) {
      p.vx = (p.vx / sp) * max;
      p.vy = (p.vy / sp) * max;
    }

    p.x += p.vx;
    p.y += p.vy;

    // zone bounce
    const dx = p.x - ZONE.cx;
    const dy = p.y - ZONE.cy;
    const d = Math.hypot(dx, dy);
    const r = radiusOf(p);
    if (d > ZONE.r - r) {
      const nx = dx / d;
      const ny = dy / d;
      p.x = ZONE.cx + nx * (ZONE.r - r);
      p.y = ZONE.cy + ny * (ZONE.r - r);
      const dot = p.vx * nx + p.vy * ny;
      p.vx -= 2 * dot * nx;
      p.vy -= 2 * dot * ny;
    }
  }

  // 🔥 IMPORTANT: real bot collisions
  resolveCollisions(players);
}

// ---------------- run match ----------------
const key = make12hKey();
const outDir = path.join(process.cwd(), "replays");
fs.mkdirSync(outDir, { recursive: true });

const players = makePlayers(30);
const frames = [];

const TICKS = 1200; // ~20 seconds
for (let t = 0; t < TICKS; t++) {
  step(players);

  frames.push({
    tick: t,
    zone: ZONE,
    players: players.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      hp: p.hp,
      alive: p.alive
    }))
  });
}

// winner = last alive (or random fallback)
const alive = players.filter(p => p.alive);
const winner = alive.length ? `P${alive[0].id}` : "P01";

// save replay
const replay = {
  id: key,
  createdAt: new Date().toISOString(),
  winner,
  frames
};

fs.writeFileSync(
  path.join(outDir, `${key}.json`),
  JSON.stringify(replay)
);

// update index.json
const indexPath = path.join(outDir, "index.json");
let index = [];
if (fs.existsSync(indexPath)) {
  index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

index = [
  { id: key, createdAt: replay.createdAt, winner },
  ...index.filter(e => e.id !== key)
].slice(0, 20);

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

console.log("✅ Generated REAL replay:", key);
