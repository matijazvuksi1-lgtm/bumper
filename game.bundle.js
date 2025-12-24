(function () {
  "use strict";

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function clampInt(v, a, c) { return Math.max(a, Math.min(c, v|0)); }

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

  function fmtCountdown(ms) {
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  }

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function nowMs() { return Date.now(); }

  // ---------- config ----------
  const CFG = window.GAME_CONFIG || {};
  const UI = CFG.ui || {};
  const META = CFG.meta || {};
  const MATCH = CFG.match || {};
  const PHYS = CFG.physics || {};
  const MOTION = CFG.motion || {};
  const AI = CFG.ai || {};
  const PLAYER = CFG.player || {};
  const DAMAGE = CFG.damage || {};
  const ZONE = CFG.zone || {};
  const REPLAY = CFG.replay || {};
  const HISTORY = CFG.history || {};
  const RARITY = CFG.rarity || {};

  const GAME = {
    players: MATCH.players ?? 30,
    tickMs: MATCH.tickMs ?? 16,
    subSteps: MATCH.subSteps ?? 2,

    friction: PHYS.friction ?? 0.9965,
    restitution: PHYS.restitution ?? 0.985,
    pushApart: PHYS.pushApart ?? 0.95,

    minSpeed: MOTION.minSpeed ?? 2.3,
    maxSpeed: MOTION.maxSpeed ?? 5.2,

    steerJitter: AI.steerJitter ?? 0.10,
    steerForce: AI.steerForce ?? 0.060,
    zoneSteerBoost: AI.zoneSteerBoost ?? 0.13,

    aggressive: AI.aggressive || { seekRange: 260, seekForce: 0.085 },
    balanced: AI.balanced || { seekRange: 200, seekForce: 0.060 },
    coward: AI.coward || { fleeHp: 35, fleeForce: 0.10, fleeRange: 300 },

    baseRadius: PLAYER.baseRadius ?? 11,
    minRadiusScale: PLAYER.minRadiusScale ?? 0.70,
    maxRadiusScale: PLAYER.maxRadiusScale ?? 1.45,
    massMin: PLAYER.massMin ?? 0.75,
    massMax: PLAYER.massMax ?? 1.55,

    baseContactDamage: DAMAGE.baseContactDamage ?? 2,
    impactDamageScale: DAMAGE.impactDamageScale ?? 1.15,
    minImpactForDamage: DAMAGE.minImpactForDamage ?? 0.75,
    damageCooldownTicks: DAMAGE.damageCooldownTicks ?? 8,

    zoneWarmupTicks: ZONE.warmupTicks ?? 90,
    zoneShrinkEveryTicks: ZONE.shrinkEveryTicks ?? 65,
    zoneShrinkStep: ZONE.shrinkStep ?? 10,
    zoneEndRadius: ZONE.endRadius ?? 80,
    zoneShiftMax: ZONE.shiftMax ?? 140,
    zoneMoveDurationTicks: ZONE.moveDurationTicks ?? 120,

    timezone: META.timezone || "Europe/Zagreb",
    resetHour: META.dailyResetHour ?? 12,
    resetMinute: META.dailyResetMinute ?? 0,

    replaySampleEveryTicks: REPLAY.sampleEveryTicks ?? 2,
    replayMaxFrames: REPLAY.maxFrames ?? 9000,

    keepDays: HISTORY.keepDays ?? 7,

    rarityTiers: (RARITY.tiers || null),
    rarityStrokeWidth: RARITY.strokeWidth ?? 3,
    rarityNamePrefixInPanels: RARITY.namePrefixInPanels !== false,
    rarityGuaranteedLegendary: RARITY.guaranteedLegendary ?? 2,

    nameSize: UI.botNameFontSize ?? 14,
    nameFont: UI.botNameFontFamily || "Arial",

    showDamageNumbers: UI.showDamageNumbers !== false,
    showHitSparks: UI.showHitSparks !== false,
    lowHpGlow: UI.lowHpGlow !== false
  };

  // ---------- daily key ----------
  function getDailyKey(date = new Date()) {
    const p = getTzParts(date, GAME.timezone);
    const resetHM = GAME.resetHour * 60 + GAME.resetMinute;
    const nowHM = p.hour * 60 + p.minute;

    let y = p.year, m = p.month, d = p.day;
    if (nowHM < resetHM) {
      const dt = new Date(date.getTime() - 24 * 60 * 60 * 1000);
      const q = getTzParts(dt, GAME.timezone);
      y = q.year; m = q.month; d = q.day;
    }
    return `${y}${pad2(m)}${pad2(d)}`;
  }

  function msUntilNextReset() {
    const now = new Date();
    const p = getTzParts(now, GAME.timezone);
    const resetHM = GAME.resetHour * 60 + GAME.resetMinute;
    const nowHM = p.hour * 60 + p.minute;
    const addDays = (nowHM < resetHM) ? 0 : 1;
    const target = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);

    let best = target.getTime();
    for (let i = -6 * 60; i <= 6 * 60; i++) {
      const t = new Date(target.getTime() + i * 60 * 1000);
      const q = getTzParts(t, GAME.timezone);
      const hm = q.hour * 60 + q.minute;
      if (hm === resetHM) { best = t.getTime(); break; }
    }
    return Math.max(0, best - now.getTime());
  }

  function dailySeedFromKey(key) {
    return hash32(`BUMPER|${key}|RESET@${GAME.resetHour}:${GAME.resetMinute}`);
  }

  // ---------- storage keys ----------
  const CHAMP_KEY = (k) => `bumper_champ_${k}`;
  const REPLAY_KEY = (k) => `bumper_replay_${k}`;
  const HISTORY_KEY = "bumper_history_keys_v1";

// ---------- fixed roster (persistent rarity/personality/stats) ----------
const ROSTER_KEY = "bumper_roster_v1"; // DO NOT RESET
const BOT_STATS_KEY = "bumper_bot_stats_v1";
const BOT_LIFE_LAST_KEY = "bumper_last_recorded_life_v1";
const BOT_SEASON_LAST_KEY = "bumper_last_recorded_season_v1";

function getSeasonId(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function seasonKey(seasonId) { return `bumper_season_stats_${seasonId}`; }

function getTierByName(name) {
  const tiers = getRarityTiers();
  return tiers.find(t => t.name === name) || tiers[0];
}

function getOrCreateRoster() {
  const existing = loadJSON(ROSTER_KEY, null);
  if (existing && Array.isArray(existing) && existing.length) {
      // backward compat: convert old Coward -> Survivor
      for (const r of existing) { if (r && r.personality === "Coward") r.personality = "Survivor"; }
      saveJSON(ROSTER_KEY, existing);
      return existing;
    }

  const rng = mulberry32(hash32("BUMPER_ROSTER_V1"));
  const roster = [];
  for (let i = 1; i <= GAME.players; i++) {
    const rarity = rollRarity(rng);
    const personality = pickPersonality(rng);
    const varianceSeed = Math.floor(rng() * 4294967295) >>> 0;
    roster.push({ id: i, rarityName: rarity.name, personality, varianceSeed });
  }

  const need = Math.max(0, (GAME.rarityGuaranteedLegendary || 2) - roster.filter(r => r.rarityName === "Legendary").length);
  if (need > 0) {
    const promotables = roster.filter(r => r.rarityName !== "Legendary");
    for (let k = 0; k < need && k < promotables.length; k++) promotables[k].rarityName = "Legendary";
  }

  saveJSON(ROSTER_KEY, roster);
  return roster;
}

function emptyBotStats() {
  const s = {};
  for (let i = 1; i <= GAME.players; i++) s[i] = { games: 0, wins: 0 };
  return s;
}
function loadBotStats(key) {
  const s = loadJSON(key, null);
  if (s && typeof s === "object") return s;
  const fresh = emptyBotStats();
  saveJSON(key, fresh);
  return fresh;
}
function winrateOf(st) { return (!st || !st.games) ? 0 : (st.wins / st.games); }
function fmtPct(x) { return `${Math.round((x || 0) * 100)}%`; }

function bumpMatchStats(state) {
  const dailyKey = state.dailyKey;
  if (!dailyKey) return;

  const lastLife = loadJSON(BOT_LIFE_LAST_KEY, null);
  if (lastLife !== dailyKey) {
    const life = loadBotStats(BOT_STATS_KEY);
    for (const p of state.players) {
      const id = String(p.id);
      if (!life[id]) life[id] = { games: 0, wins: 0 };
      life[id].games += 1;
    }
    const winId = parseInt(String(state.winner || "").replace(/^P/, ""), 10);
    if (Number.isFinite(winId) && life[String(winId)]) life[String(winId)].wins += 1;
    saveJSON(BOT_STATS_KEY, life);
    saveJSON(BOT_LIFE_LAST_KEY, dailyKey);
  }

  const seasonId = getSeasonId(new Date());
  const seasonLastKey = `${seasonId}:${dailyKey}`;
  const lastSeason = loadJSON(BOT_SEASON_LAST_KEY, null);
  if (lastSeason !== seasonLastKey) {
    const skey = seasonKey(seasonId);
    const seas = loadBotStats(skey);
    for (const p of state.players) {
      const id = String(p.id);
      if (!seas[id]) seas[id] = { games: 0, wins: 0 };
      seas[id].games += 1;
    }
    const winId = parseInt(String(state.winner || "").replace(/^P/, ""), 10);
    if (Number.isFinite(winId) && seas[String(winId)]) seas[String(winId)].wins += 1;
    saveJSON(skey, seas);
    saveJSON(BOT_SEASON_LAST_KEY, seasonLastKey);
  }
}


  function saveJSON(k, obj) { try { localStorage.setItem(k, JSON.stringify(obj)); } catch { } }
  function loadJSON(k, fallback) { try { const s = localStorage.getItem(k); return s ? safeJsonParse(s, fallback) : fallback; } catch { return fallback; } }

  function addToHistoryKeyList(dailyKey) {
    const arr = loadJSON(HISTORY_KEY, []);
    const next = [dailyKey, ...arr.filter(x => x !== dailyKey)].slice(0, GAME.keepDays);
    saveJSON(HISTORY_KEY, next);
    return next;
  }
  function getHistoryKeyList() { return loadJSON(HISTORY_KEY, []); }

  // ---------- UI refs ----------
  const elMode = $("pMode");
  const elAlive = $("pAlive");
  const elZone = $("pZone");
  const elPhase = $("pPhase");
  const elNext = $("pNext");
  const elChampion = $("pChampion");

  const lbBody = $("leaderboardBody");
  const lbMeta = $("lbMeta");
  const kfList = $("killfeedList");

  const top5Body = $("top5Body");
  const top5Meta = $("top5Meta");
  const botsBody = $("botsBody");
  const botsMeta = $("botsMeta");
  const historyBody = $("historyBody");

  const btnPause = $("btnPause");
  const btnOpenReplay = $("btnOpenReplay");
  const btnShare = $("btnShare");

  const winnerOverlay = $("winnerOverlay");
  const btnWinnerClose = $("btnWinnerClose");
  const winName = $("winName");
  const winKey = $("winKey");
  const winRarity = $("winRarity");
  const winKills = $("winKills");


// Bot card overlay
const botOverlay = $("botOverlay");
const btnBotClose = $("btnBotClose");
const botTitle = $("botTitle");
const botRarity = $("botRarity");
const botPersonality = $("botPersonality");
const botStatus = $("botStatus");
const botHpMax = $("botHpMax");
const botSpeed = $("botSpeed");
const botDmg = $("botDmg");
const botDef = $("botDef");
const botMass = $("botMass");
const botLifeGames = $("botLifeGames");
const botLifeWins = $("botLifeWins");
const botLifeWinrate = $("botLifeWinrate");
const botSeasonId = $("botSeasonId");
const botSeasonGames = $("botSeasonGames");
const botSeasonWins = $("botSeasonWins");
const botSeasonWinrate = $("botSeasonWinrate");

// Season leaderboard panel
const seasonBody = $("seasonBody");
const seasonMeta = $("seasonMeta");

  const winDmg = $("winDmg");
  const winTime = $("winTime");
  const winNext = $("winNext");

  // ---------- canvas ----------
  const canvas = $("c");
  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ---------- minimap ----------
  const mini = $("mini");
  const mctx = mini.getContext("2d");
  function resizeMini() {
    const dpr = window.devicePixelRatio || 1;
    const w = mini.clientWidth || 160;
    const h = mini.clientHeight || 160;
    mini.width = Math.floor(w * dpr);
    mini.height = Math.floor(h * dpr);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeMini);
  resizeMini();

  // ---------- URL mode: replay window ----------
  const params = new URLSearchParams(location.search);
  const replayDailyKey = params.get("replay"); // e.g. ?replay=20251222
  const MODE = replayDailyKey ? "REPLAY" : "LIVE";

  // ---------- effects (combat readability) ----------
  const dmgNumbers = []; // {x,y,text,ttl,vy}
  const sparks = [];     // {x,y,ttl,dx,dy}

  function spawnDmgNumber(x, y, amount) {
    if (!GAME.showDamageNumbers) return;
    dmgNumbers.push({ x, y, text: `-${amount}`, ttl: 38, vy: -0.55 });
    if (dmgNumbers.length > 200) dmgNumbers.splice(0, 50);
  }

  function spawnSpark(x, y, nx, ny) {
    if (!GAME.showHitSparks) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.2;
      const sp = 1.5 + Math.random() * 2.4;
      sparks.push({ x, y, ttl: 18 + Math.floor(Math.random() * 10), dx: Math.cos(a) * sp, dy: Math.sin(a) * sp });
    }
    if (sparks.length > 300) sparks.splice(0, 80);
  }

  // ---------- killfeed ----------
  const feed = [];
  function pushFeed(html) {
    feed.unshift({ t: Date.now(), html });
    if (feed.length > 10) feed.length = 10;
    renderKillfeed();
  }
  function renderKillfeed() {
    kfList.innerHTML = "";
    for (const it of feed) {
      const d = document.createElement("div");
      d.className = "feedItem";
      d.innerHTML = it.html;
      kfList.appendChild(d);
    }
  }

  // ---------- zone ----------
  function newZone(rng) {
    const baseR = Math.min(window.innerWidth, window.innerHeight) * 0.43;
    const startR = Math.max(280, Math.min(520, Math.floor(baseR)));
    const cx = window.innerWidth * 0.5 + (rng() - 0.5) * 30;
    const cy = window.innerHeight * 0.5 + (rng() - 0.5) * 30;
    return { cx, cy, r: startR, startR, fromX: cx, fromY: cy, toX: cx, toY: cy, moveT: 1, moveStartTick: 0 };
  }

  function scheduleZoneMove(zone, rng, tick) {
    zone.fromX = zone.cx; zone.fromY = zone.cy;
    const ang = rng() * Math.PI * 2;
    const mag = rng() * GAME.zoneShiftMax;
    const tx = zone.cx + Math.cos(ang) * mag;
    const ty = zone.cy + Math.sin(ang) * mag;
    const pad = Math.max(40, zone.r + 20);
    zone.toX = clamp(tx, pad, window.innerWidth - pad);
    zone.toY = clamp(ty, pad, window.innerHeight - pad);
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

  // ---------- player sizing ----------
  function hpToScale(hp, hpMax = 100) {
    const t = clamp(hpMax ? (hp / hpMax) : 0, 0, 1);
    const s = t * t * (3 - 2 * t);
    return lerp(GAME.minRadiusScale, GAME.maxRadiusScale, s);
  }
  function radiusOf(p) { return GAME.baseRadius * hpToScale(p.hp, p.hpMax || 100); }

  // ---------- personalities ----------
  const PERSONALITIES = ["Aggressive", "Balanced", "Survivor"];
  function pickPersonality(rng) {
    const r = rng();
    if (r < 0.34) return "Aggressive";
    if (r < 0.74) return "Balanced";
    return "Survivor";
  }
  function personalityTag(p) {
    if (p.personality === "Aggressive") return "🔥 AGG";
    if (p.personality === "Survivor") return "🛡️ SURV";
    return "⚖ BAL";
  }


// ---------- rarity (tiers + stat multipliers) ----------
const DEFAULT_RARITY_TIERS = [
  { name: "Common",    weight: 35, hpMult: 1.00, speedMult: 1.00, dmgMult: 1.00, defMult: 1.00, massMult: 1.00, color: "#9aa0a6", icon: "⚪" },
  { name: "Uncommon",  weight: 28, hpMult: 1.05, speedMult: 1.02, dmgMult: 1.04, defMult: 1.02, massMult: 1.02, color: "#34c759", icon: "🟢" },
  { name: "Rare",      weight: 20, hpMult: 1.10, speedMult: 1.04, dmgMult: 1.08, defMult: 1.05, massMult: 1.03, color: "#0a84ff", icon: "🔵" },
  { name: "Epic",      weight: 10, hpMult: 1.14, speedMult: 1.06, dmgMult: 1.12, defMult: 1.08, massMult: 1.04, color: "#bf5af2", icon: "🟣" },
  { name: "Legendary", weight: 7,  hpMult: 1.18, speedMult: 1.08, dmgMult: 1.15, defMult: 1.12, massMult: 1.05, color: "#ffd60a", icon: "🟡" }
];

function getRarityTiers() {
  const tiers = GAME.rarityTiers && Array.isArray(GAME.rarityTiers) && GAME.rarityTiers.length
    ? GAME.rarityTiers
    : DEFAULT_RARITY_TIERS;
  return tiers;
}

  // ---------- MANUAL FIXED BOT STATS (no multipliers, no storage) ----------
  const BOT_PROFILES = {
    1: { rarityName: "Epic", personality: "Balanced", speed: 63, dmg: 61, def: 80, hpStat: 85, hpMax: 180 },
    2: { rarityName: "Epic", personality: "Balanced", speed: 73, dmg: 79, def: 71, hpStat: 84, hpMax: 179 },
    3: { rarityName: "Common", personality: "Balanced", speed: 48, dmg: 63, def: 61, hpStat: 38, hpMax: 119 },
    4: { rarityName: "Legendary", personality: "Balanced", speed: 92, dmg: 73, def: 75, hpStat: 80, hpMax: 174 },
    5: { rarityName: "Epic", personality: "Survivor", speed: 56, dmg: 82, def: 75, hpStat: 72, hpMax: 164 },
    6: { rarityName: "Common", personality: "Aggressive", speed: 51, dmg: 65, def: 52, hpStat: 54, hpMax: 140 },
    7: { rarityName: "Epic", personality: "Aggressive", speed: 73, dmg: 71, def: 71, hpStat: 61, hpMax: 149 },
    8: { rarityName: "Rare", personality: "Balanced", speed: 75, dmg: 66, def: 62, hpStat: 73, hpMax: 165 },
    9: { rarityName: "Common", personality: "Balanced", speed: 65, dmg: 50, def: 57, hpStat: 56, hpMax: 143 },
    10: { rarityName: "Rare", personality: "Survivor", speed: 67, dmg: 68, def: 74, hpStat: 53, hpMax: 139 },
    11: { rarityName: "Rare", personality: "Aggressive", speed: 73, dmg: 75, def: 55, hpStat: 48, hpMax: 132 },
    12: { rarityName: "Rare", personality: "Balanced", speed: 73, dmg: 69, def: 71, hpStat: 72, hpMax: 164 },
    13: { rarityName: "Common", personality: "Balanced", speed: 46, dmg: 56, def: 61, hpStat: 47, hpMax: 131 },
    14: { rarityName: "Rare", personality: "Survivor", speed: 67, dmg: 50, def: 74, hpStat: 56, hpMax: 143 },
    15: { rarityName: "Legendary", personality: "Balanced", speed: 83, dmg: 85, def: 85, hpStat: 74, hpMax: 166 },
    16: { rarityName: "Common", personality: "Aggressive", speed: 41, dmg: 60, def: 53, hpStat: 51, hpMax: 136 },
    17: { rarityName: "Epic", personality: "Aggressive", speed: 62, dmg: 85, def: 65, hpStat: 73, hpMax: 165 },
    18: { rarityName: "Common", personality: "Balanced", speed: 62, dmg: 56, def: 53, hpStat: 64, hpMax: 153 },
    19: { rarityName: "Rare", personality: "Balanced", speed: 57, dmg: 63, def: 64, hpStat: 55, hpMax: 142 },
    20: { rarityName: "Common", personality: "Survivor", speed: 58, dmg: 60, def: 52, hpStat: 45, hpMax: 128 },
    21: { rarityName: "Rare", personality: "Balanced", speed: 62, dmg: 73, def: 57, hpStat: 73, hpMax: 165 },
    22: { rarityName: "Rare", personality: "Survivor", speed: 67, dmg: 53, def: 75, hpStat: 48, hpMax: 132 },
    23: { rarityName: "Epic", personality: "Balanced", speed: 76, dmg: 80, def: 64, hpStat: 71, hpMax: 162 },
    24: { rarityName: "Common", personality: "Balanced", speed: 64, dmg: 37, def: 62, hpStat: 62, hpMax: 151 },
    25: { rarityName: "Common", personality: "Aggressive", speed: 54, dmg: 49, def: 43, hpStat: 37, hpMax: 118 },
    26: { rarityName: "Common", personality: "Aggressive", speed: 46, dmg: 55, def: 44, hpStat: 63, hpMax: 152 },
    27: { rarityName: "Rare", personality: "Aggressive", speed: 60, dmg: 73, def: 64, hpStat: 64, hpMax: 153 },
    28: { rarityName: "Common", personality: "Balanced", speed: 44, dmg: 40, def: 49, hpStat: 48, hpMax: 132 },
    29: { rarityName: "Rare", personality: "Balanced", speed: 72, dmg: 67, def: 47, hpStat: 75, hpMax: 168 },
    30: { rarityName: "Common", personality: "Aggressive", speed: 43, dmg: 52, def: 37, hpStat: 54, hpMax: 140 },
  };



function rollRarity(rng) {
  const tiers = getRarityTiers();
  let total = 0;
  for (const t of tiers) total += (t.weight || 0);
  let r = rng() * total;
  for (const t of tiers) {
    r -= (t.weight || 0);
    if (r <= 0) return t;
  }
  return tiers[tiers.length - 1];
}

function rarityTag(p, short = true) {
  const r = p.rarity || { name: "Common", icon: "⚪" };
  if (!short) return `${r.icon} ${r.name}`;
  // short tags for UI compactness
  if (r.name === "Legendary") return "🟡 LEG";
  if (r.name === "Epic") return "🟣 EPC";
  if (r.name === "Rare") return "🔵 RAR";
  if (r.name === "Uncommon") return "🟢 UNC";
  return "⚪ COM";
}

function rarityColor(p) {
  return (p.rarity && p.rarity.color) ? p.rarity.color : "#9aa0a6";
}


  

function clampMult(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function jitterByRarityName(name) {
  // small random per-bot variance so every bot has slightly different stats
  if (name === "Legendary") return 0.035;
  if (name === "Epic") return 0.045;
  if (name === "Rare") return 0.055;
  if (name === "Uncommon") return 0.060;
  return 0.065; // Common
}

function applyRarityToPlayer(p, rarity, rng) {
  p.rarity = rarity;

  const j = jitterByRarityName(rarity.name);
  const jmul = () => (1 + (rng() - 0.5) * 2 * j);

  // multipliers (each bot ends up different)
  p.speedMult = clampMult((rarity.speedMult || 1) * jmul(), 0.80, 1.60);
  p.dmgMult   = clampMult((rarity.dmgMult   || 1) * jmul(), 0.80, 1.80);
  p.defMult   = clampMult((rarity.defMult   || 1) * jmul(), 0.80, 1.80);

  // HP becomes max HP
  p.hpMax = Math.max(1, Math.round(100 * (rarity.hpMult || 1) * jmul()));
  p.hp = Math.min(p.hp, p.hpMax);

  // mass affects collisions
  const massMult = clampMult((rarity.massMult || 1) * jmul(), 0.80, 1.40);
  p.mass = p.massBase * massMult;
  p.invMass = 1 / p.mass;
}

// ---------- players ----------
  
function createPlayer(id, rng, zone, roster) {
  const prof = BOT_PROFILES[id] || BOT_PROFILES[1];
  const tier = getTierByName(prof.rarityName);
  const rarity = tier || rollRarity(rng);

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

    // base stats (will be modified by rarity + per-bot variance)
    speedMult: 1,
    dmgMult: 1,
    defMult: 1,
    hpMax: 100,

    x, y,
    vx: Math.cos(dir) * sp,
    vy: Math.sin(dir) * sp,
    dir,

    massBase,
    mass: massBase,
    invMass: 1 / massBase,

    hp: 100,
    alive: true,
    hitCd: 0,
    hitFlash: 0,

    // stats
    kills: 0,
    dmgDealt: 0,
    dmgTaken: 0,

    // ai memory
    targetId: null
  };

  // apply rarity multipliers (safe + deterministic)
    // Apply fixed stats directly (0-100)
  p.rarity = rarity;
  p.speedStat = prof.speed;
  p.dmgStat = prof.dmg;
  p.defStat = prof.def;
  p.hpStat = prof.hpStat;
  p.hpMax = prof.hpMax;
  p.hp = p.hpMax;
  // mass based on rarity (physics only)
  p.mass = p.massBase * clampMult(rarity.massMult || 1, 0.8, 1.4);

  // ensure velocity respects speedMult immediately
  const curSp = Math.hypot(p.vx, p.vy) || 1;
  const maxSp = GAME.maxSpeed * (p.speedMult || 1);
  const minSp = GAME.minSpeed * (p.speedMult || 1);
  const clamped = Math.max(minSp, Math.min(maxSp, curSp));
  p.vx = (p.vx / curSp) * clamped;
  p.vy = (p.vy / curSp) * clamped;

  return p;
}

  // ---------- replay capture per-day ----------
  let replayCapture = null;

  function beginReplayCapture(state) {
    replayCapture = {
      version: 2,
      startedAt: new Date().toISOString(),
      dailyKey: state.dailyKey,
      seed: state.seed,
      frames: [],
      summary: null
    };
  }

  function captureReplayFrame(state) {
    if (!replayCapture) return;
    if (state.tick % GAME.replaySampleEveryTicks !== 0) return;
    if (replayCapture.frames.length >= GAME.replayMaxFrames) return;

    replayCapture.frames.push({
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
        defMult: p.defMult
      })),
      // (optional) small effects snapshot not needed
    });
  }

  function finalizeReplay(state, winnerStats) {
    if (!replayCapture) return;
    replayCapture.finishedAt = new Date().toISOString();
    replayCapture.summary = {
      winner: state.winner,
      dailyKey: state.dailyKey,
      seed: state.seed,
      durationTicks: state.tick,
      winnerStats
    };

    saveJSON(REPLAY_KEY(state.dailyKey), replayCapture);
    addToHistoryKeyList(state.dailyKey);
  }

  // ---------- match state ----------
  function newDailyMatch() {
    const dailyKey = getDailyKey(new Date());
    const seed = dailySeedFromKey(dailyKey);
    const rng = mulberry32(seed);

    const zone = newZone(rng);
    
const roster = getOrCreateRoster();
    const players = [];
    for (let i = 1; i <= GAME.players; i++) players.push(createPlayer(i, rng, zone, roster));
    // guarantee at least N legendaries (deterministic per-day)
    const tiers = getRarityTiers();
    const LEG = tiers.find(t => t.name === "Legendary") || DEFAULT_RARITY_TIERS[DEFAULT_RARITY_TIERS.length - 1];
    const need = Math.max(0, (GAME.rarityGuaranteedLegendary || 2) - players.filter(p => p.rarity && p.rarity.name === "Legendary").length);
    for (let k = 0; k < need; k++) {
      const non = players.filter(p => !p.rarity || p.rarity.name !== "Legendary");
      if (!non.length) break;
      const pick = non[Math.floor(rng() * non.length)];
      applyRarityToPlayer(pick, LEG, rng);
    }

    const state = {
      mode: "LIVE",
      dailyKey,
      seed,
      rng,
      tick: 0,
      startedAtMs: nowMs(),
      zone,
      players,
      finished: false,
      winner: null,
      matchEndedAt: null
    };

    beginReplayCapture(state);
    pushFeed(`New daily match started: <b>${dailyKey}</b>`);
    return state;
  }

  // ---------- replay window mode ----------
  function loadReplayForKey(key) {
    return loadJSON(REPLAY_KEY(key), null);
  }

  // ---------- physics ----------
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

  function eliminate(victim, killerName) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.vx = victim.vy = 0;
    pushFeed(`<b>${victim.name}</b> eliminated${killerName ? ` by <b>${killerName}</b>` : ""}`);
  }

  function contactDamage(a, b, impact, nx, ny) {
    if (impact < GAME.minImpactForDamage) return;

    const base = Math.max(1, Math.floor(GAME.baseContactDamage + impact * GAME.impactDamageScale));

    const apply = (victim, attacker) => {
      if (!victim.alive || !attacker.alive) return;
      if (victim.hitCd !== 0) return;

      const atkT = clamp((attacker.dmgStat ?? 50) / 100, 0, 1);
      const defT = clamp((victim.defStat ?? 50) / 100, 0, 1);
      const atkF = lerp(0.75, 1.55, atkT);
      const defF = lerp(0.75, 1.60, defT);
      const dmg = Math.max(1, Math.floor((base * atkF) / defF));
      victim.hp -= dmg;
      attacker.dmgDealt += dmg;
      victim.dmgTaken += dmg;
      victim.hitCd = GAME.damageCooldownTicks;
      victim.hitFlash = 8;

      // readability effects
      spawnDmgNumber(victim.x, victim.y - 10, dmg);
      spawnSpark((victim.x + attacker.x) * 0.5, (victim.y + attacker.y) * 0.5, nx, ny);

      if (victim.hp <= 0) {
        eliminate(victim, attacker.name);
        attacker.kills++;
      }
    };

    apply(a, b);
    apply(b, a);
  }

  function collidePlayers(a, b) {
    if (!a.alive || !b.alive) return;

    const ar = radiusOf(a);
    const br = radiusOf(b);
    const dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    const minDist = ar + br;
    if (dist >= minDist || dist === 0) return;

    const nx = dx / dist, ny = dy / dist;

    const overlap = minDist - dist;
    const invMassSum = a.invMass + b.invMass;
    const sepA = overlap * (a.invMass / invMassSum) * GAME.pushApart;
    const sepB = overlap * (b.invMass / invMassSum) * GAME.pushApart;

    a.x -= nx * sepA; a.y -= ny * sepA;
    b.x += nx * sepB; b.y += ny * sepB;

    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal > 0) return;

    const e = GAME.restitution;
    let j = -(1 + e) * velAlongNormal;
    j /= invMassSum;

    const impX = j * nx, impY = j * ny;
    a.vx -= impX * a.invMass; a.vy -= impY * a.invMass;
    b.vx += impX * b.invMass; b.vy += impY * b.invMass;

    contactDamage(a, b, Math.abs(velAlongNormal), nx, ny);
  }

  // ---------- AI (personality + simple target logic) ----------
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
    // base random wobble
    p.dir += (state.rng() - 0.5) * 2 * GAME.steerJitter;

    // zone safety pull if close to edge
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

    // personality logic
    if (p.personality === "Aggressive") {
      const cfg = GAME.aggressive;
      const target = findNearestAliveEnemy(state, p, cfg.seekRange);
      if (target) {
        const ang = Math.atan2(target.y - p.y, target.x - p.x);
        // steer toward
        let delta = ang - p.dir;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        p.dir += delta * 0.08;
        p.vx += Math.cos(ang) * cfg.seekForce;
        p.vy += Math.sin(ang) * cfg.seekForce;
      }
    } else if (p.personality === "Survivor") {
  // Survivor = cautious but still fights (not a perma-runner)
  const cfg = GAME.coward;

  // quick alive count (local)
  let alive = 0;
  for (const q of state.players) if (q.alive) alive++;

  // low HP: flee from nearest threat
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
    // healthy: behave close to Balanced (small seek), more aggressive late game
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

      // Balanced: small seek sometimes
      const cfg = GAME.balanced;
      if (state.rng() < 0.20) {
        const target = findNearestAliveEnemy(state, p, cfg.seekRange);
        if (target) {
          const ang = Math.atan2(target.y - p.y, target.x - p.x);
          p.vx += Math.cos(ang) * cfg.seekForce * 0.55;
          p.vy += Math.sin(ang) * cfg.seekForce * 0.55;
        }
      }
    }

    // base forward thrust
    p.vx += Math.cos(p.dir) * GAME.steerForce;
    p.vy += Math.sin(p.dir) * GAME.steerForce;

    // clamp speeds
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const spT = clamp((p.speedStat ?? 50) / 100, 0, 1);
    const maxSp = lerp(GAME.minSpeed, GAME.maxSpeed, spT);
    const minSp = maxSp * 0.55;
    if (sp > maxSp) { p.vx = (p.vx / sp) * maxSp; p.vy = (p.vy / sp) * maxSp; }
    if (sp < minSp) { p.vx = (p.vx / sp) * minSp; p.vy = (p.vy / sp) * minSp; }
  }

  function aliveCount(state) {
    let n = 0;
    for (const p of state.players) if (p.alive) n++;
    return n;
  }

  function getPhaseName(state) {
    if (state.tick <= GAME.zoneWarmupTicks) return "Warmup";
    if (state.zone.r <= GAME.zoneEndRadius + 40) return "Final";
    return "Shrinking";
  }

  function shrinkZoneIfNeeded(state) {
    const z = state.zone;
    if (state.tick <= GAME.zoneWarmupTicks) return;
    if (state.tick % GAME.zoneShrinkEveryTicks !== 0) return;
    if (z.r <= GAME.zoneEndRadius) return;

    z.r = Math.max(GAME.zoneEndRadius, z.r - GAME.zoneShrinkStep);
    scheduleZoneMove(z, state.rng, state.tick);
    pushFeed(`Zone shrank to <b>${Math.floor(z.r)}</b>`);
  }

  // ---------- drawing ----------
  function personalityColor(p) {
  if (!p.alive) return "#2a2a2a";
  if (p.personality === "Aggressive") return "#ff6b6b";
  if (p.personality === "Survivor") return "#74c0fc";
  return "#06d6a0"; // Balanced
}

function playerFillColor(p) {
  if (!p.alive) return "#2a2a2a";
  return rarityColor(p); // main body uses rarity color
}

  function drawZone(state) {
    const z = state.zone;

    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(180,180,255,0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPlayers(state) {
    ctx.textAlign = "center";

    for (const p of state.players) {
      const r = radiusOf(p);

      // low HP glow
      if (GAME.lowHpGlow && p.alive && p.hp <= 30) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,80,80,0.75)";
        ctx.lineWidth = 4;
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // body
      ctx.beginPath();
      ctx.fillStyle = playerFillColor(p);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();


// rarity stroke
if (p.alive) {
  ctx.strokeStyle = rarityColor(p);
  ctx.lineWidth = GAME.rarityStrokeWidth;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
  ctx.stroke();
}


// premium Legendary pulse (subtle, FPS-safe)
if (p.alive && p.rarity && p.rarity.name === "Legendary") {
  const t = performance.now() * 0.001;
  const pulse = 0.25 + 0.10 * Math.sin(t * 2.2);
  ctx.strokeStyle = `rgba(255, 214, 10, ${pulse})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
  ctx.stroke();
}


      // hit flash ring
      if (p.hitFlash > 0 && p.alive) {
        const a = clamp(p.hitFlash / 8, 0, 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.75 * a})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // HP bar
      const bw = 44, bh = 6;
      const pct = clamp(p.hp / (p.hpMax || 100), 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(p.x - bw / 2, p.y - r - 18, bw, bh);
      ctx.fillStyle = "rgba(124,252,0,0.95)";
      ctx.fillRect(p.x - bw / 2, p.y - r - 18, bw * pct, bh);

      // name + personality tag
      ctx.fillStyle = "rgba(220,220,220,0.92)";
      ctx.font = `${GAME.nameSize}px ${GAME.nameFont}`;
      ctx.fillText(p.name, p.x, p.y + r + 14);

      ctx.fillStyle = "rgba(220,220,220,0.72)";
      ctx.font = `12px ${GAME.nameFont}`;
      ctx.fillText(`${rarityTag(p)} • ${personalityTag(p)}`, p.x, p.y + r + 28);
    }
  }

  function drawEffects() {
    // damage numbers
    for (let i = dmgNumbers.length - 1; i >= 0; i--) {
      const d = dmgNumbers[i];
      d.ttl--;
      d.y += d.vy;
      d.vy -= 0.02;

      const a = clamp(d.ttl / 38, 0, 1);
      ctx.fillStyle = `rgba(255,200,200,${0.95 * a})`;
      ctx.font = `bold 14px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(d.text, d.x, d.y);

      if (d.ttl <= 0) dmgNumbers.splice(i, 1);
    }

    // sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.ttl--;
      s.x += s.dx; s.y += s.dy;
      s.dx *= 0.92; s.dy *= 0.92;

      const a = clamp(s.ttl / 24, 0, 1);
      ctx.strokeStyle = `rgba(255,255,255,${0.65 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.dx * 2, s.y - s.dy * 2);
      ctx.stroke();

      if (s.ttl <= 0) sparks.splice(i, 1);
    }
  }

  function drawMini(state) {
    const w = mini.clientWidth || 160;
    const h = mini.clientHeight || 160;
    mctx.clearRect(0, 0, w, h);

    const z = state.zone;
    const scale = Math.min(w, h) / (z.startR * 2);
    const cx = w / 2, cy = h / 2;

    mctx.strokeStyle = "rgba(180,180,255,0.7)";
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc(cx, cy, z.r * scale, 0, Math.PI * 2);
    mctx.stroke();

    for (const p of state.players) {
      if (!p.alive) continue;
      mctx.fillStyle = (p.rarity && p.rarity.color) ? p.rarity.color : "rgba(255,255,255,0.85)";
      mctx.beginPath();
      mctx.arc(cx + (p.x - z.cx) * scale, cy + (p.y - z.cy) * scale, 2.2, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  // ---------- HUD panels ----------
  function renderLeaderboard(state) {
    lbBody.innerHTML = "";
    const list = state.players.slice().sort((a, b) => {
      const aa = a.alive ? 1 : 0, bb = b.alive ? 1 : 0;
      if (bb - aa) return bb - aa;
      if (b.kills - a.kills) return b.kills - a.kills;
      if (b.hp - a.hp) return b.hp - a.hp;
      return a.id - b.id;
    }).slice(0, 10);

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="mono">${String(i + 1).padStart(2, "0")}</span>
        <span style="flex:1;">${p.alive ? "🟢 PLAY" : "⚫ OUT"} <b>${p.name}</b> <span class="muted">${rarityTag(p)} • ${personalityTag(p)}</span></span>
        <span class="mono">HP:${Math.max(0, Math.floor(p.hp))}</span>
        <span class="mono">K:${p.kills}</span>`;
      lbBody.appendChild(row);
    }
  }

  function renderTop5(state) {
    top5Body.innerHTML = "";
    const list = state.players.filter(p => p.alive).slice().sort((a, b) =>
      (b.kills - a.kills) || (b.hp - a.hp) || (a.id - b.id)
    ).slice(0, 5);

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="mono">#${i + 1}</span>
        <span style="flex:1;"><b>${p.name}</b> <span class="muted">${rarityTag(p)} • ${personalityTag(p)}</span></span>
        <span class="mono">K:${p.kills}</span>
        <span class="mono">HP:${Math.max(0, Math.floor(p.hp))}</span>`;
      top5Body.appendChild(row);
    }

    top5Meta.textContent = `Alive:${aliveCount(state)} • Tick:${state.tick}`;
  }

  
function showBotCard(state, id) {
  if (!botOverlay) return;
  const p = state.players.find(pp => pp.id === id);
  if (!p) return;

  const seasonId = getSeasonId(new Date());
  const life = loadBotStats(BOT_STATS_KEY);
  const seas = loadBotStats(seasonKey(seasonId));
  const lifeSt = life[String(id)] || { games: 0, wins: 0 };
  const seasSt = seas[String(id)] || { games: 0, wins: 0 };

  if (botTitle) botTitle.textContent = `${p.name} (ID ${id})`;
  if (botRarity) botRarity.textContent = `Rarity: ${rarityTag(p, false)}`;
  if (botPersonality) botPersonality.textContent = `Personality: ${personalityTag(p)}`;
  if (botStatus) botStatus.textContent = p.alive ? "PLAYING" : "ELIMINATED";

  if (botHpMax) botHpMax.textContent = String(p.hpMax || 100);
  if (botSpeed) botSpeed.textContent = String(p.speedStat ?? 50);
  if (botDmg) botDmg.textContent = String(p.dmgStat ?? 50);
  if (botDef) botDef.textContent = String(p.defStat ?? 50);
  if (botMass) botMass.textContent = `${(p.mass || 0).toFixed(2)}`;

  if (botLifeGames) botLifeGames.textContent = String(lifeSt.games || 0);
  if (botLifeWins) botLifeWins.textContent = String(lifeSt.wins || 0);
  if (botLifeWinrate) botLifeWinrate.textContent = fmtPct(winrateOf(lifeSt));

  if (botSeasonId) botSeasonId.textContent = seasonId;
  if (botSeasonGames) botSeasonGames.textContent = String(seasSt.games || 0);
  if (botSeasonWins) botSeasonWins.textContent = String(seasSt.wins || 0);
  if (botSeasonWinrate) botSeasonWinrate.textContent = fmtPct(winrateOf(seasSt));

  show(botOverlay);
}

function renderSeasonLeaderboard() {
  if (!seasonBody || !seasonMeta) return;
  const seasonId = getSeasonId(new Date());
  const seas = loadBotStats(seasonKey(seasonId));

  const rows = [];
  for (let i = 1; i <= GAME.players; i++) {
    const st = seas[String(i)] || { games: 0, wins: 0 };
    rows.push({ id: i, games: st.games || 0, wins: st.wins || 0, wr: winrateOf(st) });
  }
  rows.sort((a,b) => (b.wins - a.wins) || (b.wr - a.wr) || (a.id - b.id));
  seasonMeta.textContent = `Season ${seasonId}`;

  seasonBody.innerHTML = rows.slice(0, 10).map((r, idx) => {
    const name = `P${String(r.id).padStart(2,"0")}`;
    return `
      <div class="row" data-botid="${r.id}" style="cursor:pointer;">
        <span style="flex:1;"><b>#${idx+1}</b> ${name}</span>
        <span class="mono">${r.wins}W / ${r.games}G</span>
        <span class="mono" style="width:70px; text-align:right;">${fmtPct(r.wr)}</span>
      </div>
    `;
  }).join("");
}

function installBotCardClicks(stateRef) {
  const handler = (ev) => {
    const row = ev.target && ev.target.closest ? ev.target.closest("[data-botid]") : null;
    if (!row) return;
    const id = parseInt(row.getAttribute("data-botid"), 10);
    if (Number.isFinite(id)) showBotCard(stateRef(), id);
  };
  if (botsBody) botsBody.addEventListener("click", handler);
  if (leaderboardBody) leaderboardBody.addEventListener("click", handler);
  if (top5Body) top5Body.addEventListener("click", handler);
  if (seasonBody) seasonBody.addEventListener("click", handler);
}

function renderBots(state) {
    botsBody.innerHTML = "";
    const list = state.players.slice().sort((a, b) => {
      const aa = a.alive ? 1 : 0, bb = b.alive ? 1 : 0;
      if (bb - aa) return bb - aa;
      if (b.kills - a.kills) return b.kills - a.kills;
      if (b.dmgDealt - a.dmgDealt) return b.dmgDealt - a.dmgDealt;
      return a.id - b.id;
    });

    for (const p of list) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>${p.alive ? "🟢" : "⚫"}</span>
        <span style="flex:1;"><b>${p.name}</b> <span class="muted">${rarityTag(p)} • ${personalityTag(p)}</span></span>
        <span class="mono">K:${p.kills}</span>
        <span class="mono">DMG:${Math.floor(p.dmgDealt)}</span>
        <span class="mono">HP:${Math.floor(p.hp)}</span>`;
      botsBody.appendChild(row);
    }

    // personality counts
    let agg = 0, bal = 0, cow = 0;
    for (const p of state.players) {
      if (p.personality === "Aggressive") agg++;
      else if (p.personality === "Survivor") cow++;
      else bal++;
    }
    botsMeta.textContent = `AGG:${agg} BAL:${bal} COW:${cow}`;
  }

  function renderHistory() {
    historyBody.innerHTML = "";
    const keys = getHistoryKeyList();
    if (!keys.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "No history yet. Finish a match first.";
      historyBody.appendChild(d);
      return;
    }

    for (const k of keys) {
      const champ = loadJSON(CHAMP_KEY(k), null);
      const rep = loadReplayForKey(k);
      const winner = champ?.winner || rep?.summary?.winner || "—";

      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="mono">${k}</span>
        <span style="flex:1;">🏆 <b>${winner}</b></span>
        <button data-replay="${k}">Replay</button>`;
      historyBody.appendChild(row);
    }

    // attach click
    const buttons = historyBody.querySelectorAll("button[data-replay]");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-replay");
        // open replay in new window/tab
        window.open(`index.html?replay=${encodeURIComponent(k)}`, "_blank");
      });
    });
  }

  // ---------- winner card ----------
  function openWinnerCard(state, winnerStats) {
    winName.textContent = state.winner || "—";
    winKey.textContent = `Daily: ${state.dailyKey}`;
    if (winRarity) winRarity.textContent = `Rarity: ${rarityTag(winnerStats, false)}`;
    winKills.textContent = String(winnerStats.kills);
    winDmg.textContent = String(Math.floor(winnerStats.dmgDealt));
    winTime.textContent = `${Math.floor(winnerStats.survivalSec)}s`;
    winNext.textContent = fmtCountdown(msUntilNextReset());

    winnerOverlay.classList.remove("hidden");
  }
  function closeWinnerCard() { winnerOverlay.classList.add("hidden"); }
  btnWinnerClose.addEventListener("click", closeWinnerCard);
  if (btnBotClose) btnBotClose.addEventListener("click", () => hide(botOverlay));

  // ---------- main LIVE state ----------
  let state = null;


// ---------- perf knobs ----------
// FPS fixes: update DOM panels less often + minimap less often (canvas stays smooth)
const UI_UPDATE_MS = 200;     // 5 Hz
const MINI_UPDATE_MS = 120;   // ~8 Hz
let lastUiUpdate = 0;
let lastMiniUpdate = 0;


  // ---------- LIVE vs REPLAY init ----------

function rarityIcon(name) {
  if (name === "Legendary") return "★";
  if (name === "Epic") return "◆";
  if (name === "Rare") return "●";
  return "•";
}

function rarityClass(name) {
  if (name === "Legendary") return "rarityLegendary";
  if (name === "Epic") return "rarityEpic";
  if (name === "Rare") return "rarityRare";
  return "rarityCommon";
}

function renderBotCardsGrid(sortMode) {
  const grid = document.getElementById("botCardsGrid");
  if (!grid) return;

  const rows = [];
  for (let id = 1; id <= 30; id++) {
    const prof = (typeof BOT_PROFILES !== "undefined" && BOT_PROFILES[id]) ? BOT_PROFILES[id] : null;
    if (!prof) continue;

    rows.push({
      id,
      rarity: prof.rarityName,
      personality: prof.personality,
      speed: prof.speed ?? prof.speedStat ?? 50,
      dmg: prof.dmg ?? prof.dmgStat ?? 50,
      def: prof.def ?? prof.defStat ?? 50,
      hp: prof.hpStat ?? 50,
      hpMax: prof.hpMax ?? Math.round(70 + ((prof.hpStat ?? 50) / 100) * 130),
    });
  }

  const rarityRank = { Common: 1, Rare: 2, Epic: 3, Legendary: 4 };

  rows.sort((a, c) => {
    if (sortMode === "rarity") return (rarityRank[c.rarity] - rarityRank[a.rarity]) || (a.id - c.id);
    if (sortMode === "dmg") return (c.dmg - a.dmg) || (a.id - c.id);
    if (sortMode === "speed") return (c.speed - a.speed) || (a.id - c.id);
    if (sortMode === "def") return (c.def - a.def) || (a.id - c.id);
    if (sortMode === "hp") return (c.hp - a.hp) || (a.id - c.id);
    return a.id - c.id;
  });

  grid.innerHTML = rows.map(r => {
    const rc = rarityClass(r.rarity);
    return `
      <div class="botCard ${rc}">
        <div class="botCardTop">
          <div class="botCardId">#${String(r.id).padStart(2,"0")}</div>
          <div class="botMeta">
            <div class="botBadge ${("rarityBadge"+r.rarity)}"><span class="rarityIcon">${rarityIcon(r.rarity)}</span>${r.rarity}</div>
            <div class="botBadge">${r.personality}</div>
          </div>
        </div>
        <div class="botStatGrid">
          <div class="botStat"><span class="botStatLabel">DMG</span><span class="botStatVal">${r.dmg}</span></div>
          <div class="botStat"><span class="botStatLabel">SPD</span><span class="botStatVal">${r.speed}</span></div>
          <div class="botStat"><span class="botStatLabel">DEF</span><span class="botStatVal">${r.def}</span></div>
          <div class="botStat"><span class="botStatLabel">HP</span><span class="botStatVal">${r.hp} <span style="opacity:.55;font-weight:700">(${r.hpMax})</span></span></div>
        </div>
      </div>
    `;
  }).join("");
}


function bindBotCardsControls() {
  const closeBtn = document.getElementById("botCardsClose");
  const back = document.getElementById("botCardsCloseBackdrop");
  const sel = document.getElementById("botCardsSort");

  if (closeBtn && !closeBtn.__bcBound) {
    closeBtn.__bcBound = true;
    closeBtn.addEventListener("click", closeBotCardsOverlay);
  }
  if (back && !back.__bcBound) {
    back.__bcBound = true;
    back.addEventListener("click", closeBotCardsOverlay);
  }
  if (sel && !sel.__bcBound) {
    sel.__bcBound = true;
    sel.addEventListener("change", () => renderBotCardsGrid(sel.value));
  }
}

function openBotCardsOverlay() {
  const ov = document.getElementById("botCardsOverlay");
  if (!ov) return;
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
    bindBotCardsControls();
  const sel = document.getElementById("botCardsSort");
  renderBotCardsGrid(sel ? sel.value : "id");
}

function closeBotCardsOverlay() {
  const ov = document.getElementById("botCardsOverlay");
  if (!ov) return;
  ov.classList.add("hidden");
  ov.setAttribute("aria-hidden", "true");
}

function installBotCardsOverlay() {
  const openBtn = document.getElementById("openBotCards");
  const closeBtn = document.getElementById("botCardsClose");
  const back = document.getElementById("botCardsCloseBackdrop");
  const sel = document.getElementById("botCardsSort");

  if (openBtn) openBtn.addEventListener("click", openBotCardsOverlay);
  if (closeBtn) closeBtn.addEventListener("click", closeBotCardsOverlay);
  if (back) back.addEventListener("click", closeBotCardsOverlay);
  if (sel) sel.addEventListener("change", () => renderBotCardsGrid(sel.value));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBotCardsOverlay();
  });
}


  function initLive() {
    state = newDailyMatch();
    renderHistory();
  }

  // replay window state
  let replayCache = null;
  let replayIdx = 0;
  let replayPlaying = true;
  let replayLastStepAt = 0;

  function initReplayMode(key) {
    replayCache = loadReplayForKey(key);

    elMode.textContent = `Mode: REPLAY (${key})`;
    btnPause.disabled = true;
    btnShare.disabled = true;
    btnOpenReplay.disabled = true;

    // hide killfeed (optional) but keep it
    pushFeed(`Replay opened for <b>${key}</b>`);

    if (!replayCache || !replayCache.frames || !replayCache.frames.length) {
      pushFeed(`<b>No replay found</b> for ${key}. Play that day first.`);
      // create a fallback empty state so something renders
      const rng = mulberry32(hash32("empty"));
      const zone = newZone(rng);
      state = { mode: "REPLAY", dailyKey: key, seed: 0, rng, tick: 0, startedAtMs: nowMs(), zone, players: [], finished: true, winner: "—" };
      return;
    }

    // build state object from first frame
    const first = replayCache.frames[0];
    const rng = mulberry32(replayCache.seed || 1);
    state = {
      mode: "REPLAY",
      dailyKey: key,
      seed: replayCache.seed,
      rng,
      tick: first.tick,
      startedAtMs: nowMs(),
      zone: { cx: first.zone.cx, cy: first.zone.cy, r: first.zone.r, startR: first.zone.r, fromX:first.zone.cx, fromY:first.zone.cy, toX:first.zone.cx, toY:first.zone.cy, moveT:1, moveStartTick:0 },
      players: first.players.map(fp => ({
        ...fp,
        mass: 1, invMass: 1, hitCd: 0,
        hpMax: fp.hpMax || 100,
        speedMult: fp.speedMult || 1,
        dmgMult: fp.dmgMult || 1,
        defMult: fp.defMult || 1
      })),
      finished: false,
      winner: replayCache.summary?.winner || null
    };

    // put key into history list if missing
    addToHistoryKeyList(key);
    renderHistory();

    // small controls: space toggles play/pause
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") { replayPlaying = !replayPlaying; e.preventDefault(); }
      if (e.code === "ArrowRight") replayIdx = Math.min(replayCache.frames.length - 1, replayIdx + 5);
      if (e.code === "ArrowLeft") replayIdx = Math.max(0, replayIdx - 5);
    });
  }

  function applyReplayFrame(frame) {
    state.tick = frame.tick;
    state.zone.cx = frame.zone.cx;
    state.zone.cy = frame.zone.cy;
    state.zone.r = frame.zone.r;

    // update players by id
    for (const fp of frame.players) {
      let p = state.players.find(pp => pp.id === fp.id);
      if (!p) {
        p = { ...fp, mass: 1, invMass: 1, hitCd: 0, hpMax: fp.hpMax || 100, speedMult: fp.speedMult || 1, dmgMult: fp.dmgMult || 1, defMult: fp.defMult || 1 };
        state.players.push(p);
      } else {
        Object.assign(p, fp);
      }
    }
  }

  // ---------- UI top bar ----------
  function updateTopBar() {
    elMode.textContent = `Mode: ${MODE}`;
    elAlive.textContent = `Alive: ${state ? aliveCount(state) : "—"}`;
    elZone.textContent = state ? `Zone: r=${Math.floor(state.zone.r)}` : "Zone: —";
    elPhase.textContent = state ? `Phase: ${getPhaseName(state)}` : "Phase: —";
    elNext.textContent = `Next game: ${fmtCountdown(msUntilNextReset())}`;

    const champ = state ? loadJSON(CHAMP_KEY(state.dailyKey), null) : null;
    if (champ?.winner) {
      const rt = champ.winnerStats?.rarity ? { rarity: champ.winnerStats.rarity } : null;
      elChampion.textContent = `Champion: ${champ.winner}${rt ? ` (${rarityTag(rt)})` : ""}`;
    }
    else if (state?.finished) elChampion.textContent = `Champion: ${state.winner || "—"}`;
    else elChampion.textContent = "Champion: —";

    if (state) lbMeta.textContent = `Daily:${state.dailyKey} • Seed:${state.seed}`;
  }

  // ---------- main loops ----------
  let running = true;
  btnPause.addEventListener("click", () => {
    running = !running;
    btnPause.textContent = running ? "Pause" : "Resume";
  });

  btnShare.addEventListener("click", async () => {
    if (!state) return;
    const champ = loadJSON(CHAMP_KEY(state.dailyKey), null);
    const winner = champ?.winner || state.winner || "—";
    const txt = `🏆 Daily Champion: ${winner}\n📅 Daily: ${state.dailyKey}\n⏳ Next game in: ${fmtCountdown(msUntilNextReset())}`;
    try {
      await navigator.clipboard.writeText(txt);
      pushFeed("Copied result to clipboard");
    } catch {
      prompt("Copy this:", txt);
    }
  });

  btnOpenReplay.addEventListener("click", () => {
    if (!state) return;
    window.open(`index.html?replay=${encodeURIComponent(state.dailyKey)}`, "_blank");
  });

  function stepLiveSim() {
    // daily rollover -> new match every 24h
    const curKey = getDailyKey(new Date());
    if (curKey !== state.dailyKey) {
      feed.length = 0; renderKillfeed();
      state = newDailyMatch();
      btnShare.disabled = true;
      btnOpenReplay.disabled = true;
      closeWinnerCard();
      renderHistory();
      return;
    }

    if (state.finished) return;

    state.tick++;
    updateZone(state.zone, state.tick);
    shrinkZoneIfNeeded(state);

    for (let s = 0; s < GAME.subSteps; s++) {
      for (const p of state.players) {
        if (!p.alive) continue;

        if (p.hitCd > 0) p.hitCd--;
        if (p.hitFlash > 0) p.hitFlash--;

        aiSteer(state, p);

        p.x += p.vx; p.y += p.vy;
        p.vx *= GAME.friction; p.vy *= GAME.friction;

        bounceOffZone(state, p);
      }

      const arr = state.players;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          collidePlayers(arr[i], arr[j]);
        }
      }

      for (const p of state.players) if (p.alive) bounceOffZone(state, p);
    }

    captureReplayFrame(state);

    // finish
    if (aliveCount(state) <= 1) {
      state.finished = true;
      const w = state.players.find(p => p.alive);
      state.winner = w ? w.name : "None";
      state.matchEndedAt = Date.now();

      pushFeed(`<b>${state.winner}</b> is the Champion`);

      const winnerObj = w || null;
      const survivalSec = (nowMs() - state.startedAtMs) / 1000;

      const winnerStats = winnerObj ? {
        name: winnerObj.name,
        rarity: winnerObj.rarity,
        personality: winnerObj.personality,
        kills: winnerObj.kills,
        dmgDealt: winnerObj.dmgDealt,
        dmgTaken: winnerObj.dmgTaken,
        survivalSec
      } : { name: state.winner, rarity: { name: "Common", icon: "⚪", color: "#9aa0a6" }, personality: "Balanced", kills: 0, dmgDealt: 0, dmgTaken: 0, survivalSec };

      saveJSON(CHAMP_KEY(state.dailyKey), { winner: state.winner, seed: state.seed, finishedAt: new Date().toISOString(), winnerStats });
      finalizeReplay(state, winnerStats);

      btnShare.disabled = false;
      btnOpenReplay.disabled = false;

      // show winner card
      bumpMatchStats(state);
      renderSeasonLeaderboard();
      openWinnerCard(state, winnerStats);

      renderHistory();
    }
  }

  function stepReplay() {
    if (!replayCache || !replayCache.frames || !replayCache.frames.length) return;

    const now = performance.now();
    if (!replayPlaying) return;
    if (now - replayLastStepAt < 33) return;
    replayLastStepAt = now;

    replayIdx++;
    if (replayIdx >= replayCache.frames.length) {
      replayIdx = replayCache.frames.length - 1;
      replayPlaying = false;
      state.finished = true;
      state.winner = replayCache.summary?.winner || state.winner;
      return;
    }

    applyReplayFrame(replayCache.frames[replayIdx]);
  }

  function renderFrame() {
    if (!state) return;

    const now = performance.now();

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawZone(state);
    drawPlayers(state);
    drawEffects();

    // minimap (throttled)
    if (now - lastMiniUpdate >= MINI_UPDATE_MS) {
      drawMini(state);
      lastMiniUpdate = now;
    }

    // panels (throttled)
    if (now - lastUiUpdate >= UI_UPDATE_MS) {
      updateTopBar();
      renderLeaderboard(state);
      renderTop5(state);
      renderBots(state);
      renderSeasonLeaderboard();
      lastUiUpdate = now;
    }

    requestAnimationFrame(renderFrame);
  }

  // ---------- boot ----------
  if (MODE === "LIVE") {
    initLive();
    btnShare.disabled = true;
    btnOpenReplay.disabled = (loadReplayForKey(getDailyKey(new Date())) == null);
    renderHistory();
  } else {
    initReplayMode(replayDailyKey);
  }

  // history always visible
  renderHistory();

  // periodic sim
  setInterval(() => {
    if (MODE !== "LIVE") return;
    if (!running) return;
    stepLiveSim();
  }, GAME.tickMs);

  // replay tick
  setInterval(() => {
    if (MODE !== "REPLAY") return;
    stepReplay();
  }, 16);

  // enable replay button when replay exists for today
  function refreshReplayButton() {
    if (MODE !== "LIVE") return;
    const rep = loadReplayForKey(getDailyKey(new Date()));
    btnOpenReplay.disabled = !rep;
  }
  setInterval(refreshReplayButton, 1000);

  // first feed line
  if (MODE === "LIVE") pushFeed("Ready ✅ (LIVE)");
  else pushFeed("Replay mode ✅ (SPACE to pause/play)");

  installBotCardClicks(() => state);
  installBotCardsOverlay();
  renderSeasonLeaderboard();
  renderFrame();
})();
