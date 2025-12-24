/**
 * Generate a replay JSON file + update replays/index.json
 * Runs on GitHub Actions schedule (server-side, shared for everyone).
 *
 * IMPORTANT:
 * - This template generates a SMALL demo replay (no heavy sim).
 * - Later you can replace "frames" with real match frames.
 */
const fs = require("fs");
const path = require("path");

function pad2(n){ return String(n).padStart(2,"0"); }

function tzParts(date, tz){
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: +map.year, month: +map.month, day: +map.day,
    hour: +map.hour, minute: +map.minute, second: +map.second
  };
}

function make12hKey(now, tz="Europe/Zagreb"){
  const p = tzParts(now, tz);
  const slot = (p.hour >= 6 && p.hour < 18) ? "A" : "B";
  // before 06:00 => previous day B
  let y=p.year, m=p.month, d=p.day;
  if (p.hour < 6) {
    const prev = new Date(now.getTime() - 24*60*60*1000);
    const q = tzParts(prev, tz);
    y=q.year; m=q.month; d=q.day;
  }
  return `${y}${pad2(m)}${pad2(d)}-${slot}`;
}

function ensureDir(p){ fs.mkdirSync(p, {recursive:true}); }

const outDir = path.join(process.cwd(), "replays");
ensureDir(outDir);

const key = make12hKey(new Date());
const createdAt = new Date().toISOString();

// Minimal demo replay format compatible with the viewer-only game.bundle.js:
// { frames: [ { zone, players, tick } ... ], summary: { winner } }
const replay = {
  version: 1,
  id: key,
  createdAt,
  summary: { winner: "BOT-07" },
  frames: [
    { tick: 0, zone: { r: 520 }, players: [] }
  ]
};

fs.writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify(replay));

const indexPath = path.join(outDir, "index.json");
let index = [];
try { index = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch { index = []; }
if (!Array.isArray(index)) index = [];

index = [{ id: key, createdAt, winner: replay.summary.winner }, ...index]
  .filter((v,i,a)=> a.findIndex(x=>x.id===v.id)===i)
  .slice(0, 200);

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log("Generated replay:", key);
