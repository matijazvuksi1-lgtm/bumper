// game.config.js (FULL – FAST ZONE)
window.GAME_CONFIG = {
  // ============================
  // DAILY / META
  // ============================
  meta: {
    timezone: "Europe/Zagreb",
    dailyResetHour: 12,
    dailyResetMinute: 0,
    gameName: "Bumper Royale",
    version: "1.0.1-fast-zone"
  },

  // ============================
  // MATCH CORE
  // ============================
  match: {
    players: 30,
    tickMs: 16,      // ~60 FPS
    subSteps: 2
  },

  // ============================
  // UI / HUD
  // ============================
  ui: {
    botNameFontSize: 16,
    botNameFontFamily: "Arial",

    // combat readability
    showDamageNumbers: true,
    showHitSparks: true,
    lowHpGlow: true,

    // panels
    showLeaderboard: true,
    showTop5Hub: true,
    showBotsPanel: true,
    showKillfeed: true,
    showHistoryPanel: true,

    showHpBars: true,
    showPersonalityTagUnderName: true
  },

  // ============================
  // PHYSICS
  // ============================
  physics: {
    friction: 0.9965,
    restitution: 0.985,
    pushApart: 0.95
  },

  // ============================
  // MOVEMENT
  // ============================
  motion: {
    minSpeed: 1,
    maxSpeed: 2.55
  },

  // ============================
  // PLAYER SIZE / MASS
  // ============================
  player: {
    baseRadius: 11,
    minRadiusScale: 0.70,
    maxRadiusScale: 1.45,
    massMin: 0.75,
    massMax: 1.55
  },

  // ============================
  // DAMAGE / COMBAT
  // ============================
  damage: {
    baseContactDamage: 2,
    impactDamageScale: 1.15,
    minImpactForDamage: 0.75,
    damageCooldownTicks: 8
  },

  // ============================
  // 🔥 FAST ZONE SETTINGS
  // ============================
  zone: {
    warmupTicks: 1000,        // starts much sooner
    shrinkEveryTicks: 800,   // shrinks more often
    shrinkStep: 11,         // bigger shrink each time
    endRadius: 40,          // tighter final fights
    shiftMax: 180,          // more zone movement
    moveDurationTicks: 100   // faster zone movement
  },

  // ============================
  // AI + PERSONALITIES
  // ============================
  ai: {
    // base AI movement
    steerJitter: 0.10,
    steerForce: 0.060,
    zoneSteerBoost: 0.13,

    // Aggressive bots (hunters)
    aggressive: {
      seekRange: 260,
      seekForce: 0.085,
      turnAssist: 0.08
    },

    // Balanced bots
    balanced: {
      seekRange: 200,
      seekForce: 0.060,
      seekChance: 0.20
    },

    // Coward bots (run when low HP)
    coward: {
      fleeHp: 35,
      fleeRange: 300,
      fleeForce: 0.10,
      turnAssist: 0.10
    }
  },

// ============================
// RARITY TIERS (spawn % + stat multipliers)
// ============================
rarity: {
  tiers: [
    // Weights are "fair distribution" (sum 100). Game also guarantees at least 2 Legendary per match.
    { name: "Common",    weight: 35, hpMult: 1.00, speedMult: 1.00, dmgMult: 1.00, defMult: 1.00, massMult: 1.00, color: "#9aa0a6", icon: "⚪" },
    { name: "Uncommon",  weight: 28, hpMult: 1.05, speedMult: 1.02, dmgMult: 1.04, defMult: 1.02, massMult: 1.02, color: "#34c759", icon: "🟢" },
    { name: "Rare",      weight: 20, hpMult: 1.10, speedMult: 1.04, dmgMult: 1.08, defMult: 1.05, massMult: 1.03, color: "#0a84ff", icon: "🔵" },
    { name: "Epic",      weight: 10, hpMult: 1.14, speedMult: 1.06, dmgMult: 1.12, defMult: 1.08, massMult: 1.04, color: "#bf5af2", icon: "🟣" },
    { name: "Legendary", weight: 7,  hpMult: 1.18, speedMult: 1.08, dmgMult: 1.15, defMult: 1.12, massMult: 1.05, color: "#ffd60a", icon: "🟡" }
  ],
  strokeWidth: 3,
  namePrefixInPanels: true,

  // hard rule: always at least this many Legendaries in a 30-bot match
  guaranteedLegendary: 2
},



  // ============================
  // REPLAY SYSTEM
  // ============================
  replay: {
    sampleEveryTicks: 2,
    maxFrames: 9000,
    savePerDay: true,
    openInNewWindow: true
  },

  // ============================
  // DAILY HISTORY
  // ============================
  history: {
    keepDays: 7,
    storeWinnerStats: true,
    allowReplayClick: true
  },

  // ============================
  // PERFORMANCE
  // ============================
  performance: {
    useSpatialGrid: false,
    maxEffects: 300
  },

  // ============================
  // DEBUG (OPTIONAL)
  // ============================
  debug: {
    showFps: false,
    logZoneEvents: false,
    logKills: false
  }
};
