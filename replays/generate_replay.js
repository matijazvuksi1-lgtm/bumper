// ================= GLOBAL STATS / LEADERBOARD =================
const lbPath = path.join(outDir, "leaderboard.json");
const lastPath = path.join(outDir, "last.json");

let lb = readJsonSafe(lbPath, { byId: {} });

function ensureBot(id) {
  const k = String(id);
  if (!lb.byId[k]) {
    lb.byId[k] = { id: Number(id), games: 0, wins: 0, kills: 0, dmg: 0, deaths: 0 };
  }
  return lb.byId[k];
}

// count games + deaths from last frame
const lastFrame = replay.frames[replay.frames.length - 1];
for (const p of lastFrame.players) {
  const b = ensureBot(p.id);
  b.games += 1;
  if (!p.alive) b.deaths += 1;
}

// winner
ensureBot(replay.summary.winnerId).wins += 1;

// damage + kills from events
for (const ev of replay.events || []) {
  if (ev.type === "hit") {
    ensureBot(ev.from).dmg += Number(ev.dmg || 0);
  }
  if (ev.type === "kill") {
    ensureBot(ev.killer).kills += 1;
  }
}

// write files
writeJson(lbPath, lb, true);
writeJson(lastPath, {
  id: replay.id,
  createdAt: replay.createdAt,
  winner: replay.summary.winner
}, true);
