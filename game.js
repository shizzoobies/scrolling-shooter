// ============================================================
//  SCROLLING SHOOTER  ·  game.js
//  Free movement — no lanes, canvas-drawn, all phases
// ============================================================

// ─── 1. CONFIG ───────────────────────────────────────────────
const CONFIG = {
  canvas: { width: 420, height: 660 },

  player: {
    speed:           300,   // px/s lateral movement
    fireRate:        2.2,   // shots/sec
    damage:          1,
    projectileSpeed: 520,
    width:  30, height: 30, // hitbox
    renderW: 38, renderH: 40,
    y:       610,
    margin:  22            // keep player this far from edges
  },

  projectile: { width: 6, height: 18 },

  enemies: {
    basic: { hp:1, speed:82,  scoreValue:10, w:32, h:32, shotCooldown:4.5 },  // was 3.5
    fast:  { hp:1, speed:165, scoreValue:15, w:24, h:24, shotCooldown:7.0 },  // was 5.0 — fast is a movement threat, not a bullet threat
    tank:  { hp:4, speed:48,  scoreValue:30, w:44, h:44, shotCooldown:2.6 },  // was 2.0
    elite: { hp:6, speed:110, scoreValue:50, w:36, h:36, shotCooldown:2.0 }   // was 1.5
  },

  enemyProjectile: { speed: 185, w: 5, h: 12 },  // was 210 — slightly more dodgeable
  powerups: { spreadDuration: 10, explosiveDuration: 8, explosiveRadius: 80 },

  drops:  { chance: 0.33 },  // was 0.27 — more power-ups to survive bullet phase
  pickup: { width:20, height:20, speed:56 },

  difficulty: {
    spawnInterval:       1.4,
    minSpawnInterval:    0.06,   // was 0.05
    spawnDecreasePerSec: 0.006,  // was 0.007 — slightly gentler ramp
    fastUnlockTime:      12,
    tankUnlockTime:      28,
    eliteUnlockTime:     50,
    enemyShotUnlockTime: 25,     // was 18 — give player time to grab power-ups first
    multiSpawnTime:      85,     // was 60 — after boss, not simultaneous with it
    tripleSpawnTime:     160     // was 120
  },

  particles: { count: 10 }
};

// ─── 2. CANVAS ───────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
canvas.width  = CONFIG.canvas.width;
canvas.height = CONFIG.canvas.height;

// ─── RESPONSIVE SCALING ───────────────────────────────────────
function resizeCanvas() {
  const scale = Math.min(
    window.innerWidth  / canvas.width,
    window.innerHeight / canvas.height,
    1   // never upscale beyond native resolution
  );
  canvas.style.width  = Math.floor(canvas.width  * scale) + 'px';
  canvas.style.height = Math.floor(canvas.height * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
resizeCanvas();

// ─── SPRITES ─────────────────────────────────────────────────
const SPRITES = {};
const SPRITE_PATHS = {
  player:          'Sprites/player.png',
  enemyBasic:      'Sprites/enemy_basic.png',
  enemyFast:       'Sprites/enemy_fast.png',
  enemyTank:       'Sprites/enemy_tank.png',
  enemyElite:      'Sprites/enemy_elite.png',
  bossSentinel:    'Sprites/boss_sentinel.png',
  bossDecimator:   'Sprites/boss_decimator.png',
  bossAnnihilator: 'Sprites/boss_annihilator.png',
  bulletPlayer:    'Sprites/bullet_player.png',
  bulletEnemy:     'Sprites/bullet_enemy.png',
  bulletBoss:      'Sprites/bullet_boss.png',
  pickupRapid:     'Sprites/pickup_rapid.png',
  pickupPower:     'Sprites/pickup_power.png',
  pickupSpread:    'Sprites/pickup_spread.png',
  pickupDual:      'Sprites/pickup_dual.png',
  pickupPierce:    'Sprites/pickup_pierce.png',
  pickupShield:    'Sprites/pickup_shield.png',
  pickupExplosive: 'Sprites/pickup_explosive.png',
  explosion:       'Sprites/explosion_sheet.png',
  bgNebula:        'Sprites/bg_nebula.png',
};
const PICKUP_SPRITE_KEYS = {
  fireRate:   'pickupRapid',
  damage:     'pickupPower',
  spread:     'pickupSpread',
  doubleShot: 'pickupDual',
  pierce:     'pickupPierce',
  shield:     'pickupShield',
  explosive:  'pickupExplosive',
};
const BOSS_SPRITE_KEYS = ['bossSentinel', 'bossDecimator', 'bossAnnihilator'];
function loadSprites() {
  return Promise.all(Object.entries(SPRITE_PATHS).map(([key, path]) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { SPRITES[key] = img; resolve(); };
      img.onerror = () => { console.warn(`Sprite missing: ${path}`); resolve(); };
      img.src = path;
    })
  ));
}

// Helper: draw a sprite centered at (cx,cy), optional white flash
function drawSprite(img, cx, cy, w, h, flash = false, angle = 0) {
  if (!img) return false;
  ctx.save();
  ctx.translate(cx, cy);
  if (angle) ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  if (flash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
  return true;
}

// ─── 3. GAME STATE ───────────────────────────────────────────
const game = {
  state:      'title',
  score:      0,
  highScore:  parseInt(localStorage.getItem('dls_hi') || '0'),
  time:       0,
  lastTime:   0,
  enemies:          [],
  projectiles:      [],
  enemyProjectiles: [],
  pickups:          [],
  effects:          [],
  spawnTimer:       0,
  boss:             null,
  bossWarning:      null,
  bossPhaseLabel:   null,
  nextBossTier:     0
};

const player = {
  x:               CONFIG.canvas.width / 2,
  y:               CONFIG.player.y,
  fireRate:        CONFIG.player.fireRate,
  damage:          CONFIG.player.damage,
  projectileSpeed: CONFIG.player.projectileSpeed,
  canDoubleShot:   false,
  canSpread:       false,
  canPierce:       false,
  spreadTimer:     0,
  explosiveTimer:  0,
  shield:          0,
  scoreMultiplier: 1,
  fireTimer:       0,
  upgrades:        {},
  upgradeFlash:    {},
  // Visual engine flicker
  flameLen:        0
};

const difficulty = {
  elapsed:       0,
  spawnInterval: CONFIG.difficulty.spawnInterval,
  speedScale:    1.0,
  unlockedTypes: ['basic']
};

// ─── 4. INPUT ────────────────────────────────────────────────
const keys = {};

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Space' || e.code === 'Enter') &&
      (game.state === 'title' || game.state === 'gameOver')) { startGame(); return; }
  if (e.code === 'KeyR' && game.state === 'gameOver') { startGame(); return; }
  if (e.code === 'KeyP') {
    if      (game.state === 'playing') game.state = 'paused';
    else if (game.state === 'paused')  game.state = 'playing';
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('click', e => {
  if (game.state === 'title' || game.state === 'gameOver') { startGame(); return; }
});

// ─── TOUCH ───────────────────────────────────────────────────
const touch = { active: false, x: 0, y: 0 };

function touchPos(t) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (t.clientX - r.left) * (canvas.width  / r.width),
    y: (t.clientY - r.top)  * (canvas.height / r.height)
  };
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (game.state === 'title' || game.state === 'gameOver') { startGame(); return; }
  const p = touchPos(e.touches[0]);
  touch.active = true; touch.x = p.x; touch.y = p.y;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const p = touchPos(e.touches[0]);
  touch.x = p.x; touch.y = p.y;
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (e.touches.length === 0) touch.active = false;
}, { passive: false });

// ─── MOBILE CONTROL BUTTONS ──────────────────────────────────
const muteBtn  = document.getElementById('muteBtn');
const pauseBtn = document.getElementById('pauseBtn');

muteBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const muted = MUSIC.toggleMute();
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

pauseBtn?.addEventListener('click', e => {
  e.stopPropagation();
  if      (game.state === 'playing') { game.state = 'paused';  pauseBtn.textContent = '▶'; }
  else if (game.state === 'paused')  { game.state = 'playing'; pauseBtn.textContent = '⏸'; }
});

// Auto-pause when user switches tabs
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    game.state = 'paused';
    if (pauseBtn) pauseBtn.textContent = '▶';
  }
});

// Prevent long-press context menu on canvas
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ─── 5. AUDIO ────────────────────────────────────────────────
let _ac = null;
function getAC() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

function playSound(type) {
  try {
    const ac = getAC(), osc = ac.createOscillator(), g = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    const t = ac.currentTime;
    switch (type) {
      case 'shoot':
        osc.type='square'; osc.frequency.setValueAtTime(880,t); osc.frequency.exponentialRampToValueAtTime(400,t+.07);
        g.gain.setValueAtTime(.08,t); g.gain.exponentialRampToValueAtTime(.001,t+.09); osc.start(); osc.stop(t+.09); break;
      case 'hit':
        osc.type='sawtooth'; osc.frequency.setValueAtTime(260,t); osc.frequency.exponentialRampToValueAtTime(65,t+.14);
        g.gain.setValueAtTime(.14,t); g.gain.exponentialRampToValueAtTime(.001,t+.16); osc.start(); osc.stop(t+.16); break;
      case 'pickup':
        osc.type='sine'; osc.frequency.setValueAtTime(480,t); osc.frequency.exponentialRampToValueAtTime(1080,t+.18);
        g.gain.setValueAtTime(.17,t); g.gain.exponentialRampToValueAtTime(.001,t+.22); osc.start(); osc.stop(t+.22); break;
      case 'lose':
        osc.type='sawtooth'; osc.frequency.setValueAtTime(200,t); osc.frequency.exponentialRampToValueAtTime(30,t+.7);
        g.gain.setValueAtTime(.22,t); g.gain.exponentialRampToValueAtTime(.001,t+.75); osc.start(); osc.stop(t+.75); break;
      case 'shield':
        osc.type='sine'; osc.frequency.setValueAtTime(440,t); osc.frequency.exponentialRampToValueAtTime(880,t+.05);
        osc.frequency.exponentialRampToValueAtTime(220,t+.22);
        g.gain.setValueAtTime(.2,t); g.gain.exponentialRampToValueAtTime(.001,t+.25); osc.start(); osc.stop(t+.25); break;
    }
  } catch (_) {}
}

// ─── 5b. MUSIC ───────────────────────────────────────────────
const MUSIC = (() => {
  const files  = ['Early Audio.mp3', 'Midway Audio.mp3', 'Final_Boss_Fury_2026-03-24T141755.mp3'];
  const names  = ['early', 'mid', 'boss'];
  const tracks = {};
  names.forEach((n, i) => {
    const a = new Audio(`Audio/${files[i]}`);
    a.loop = true; a.volume = 0.55;
    tracks[n] = a;
  });
  let _current = null;
  return {
    play(name) {
      if (_current === name) return;
      if (_current) { tracks[_current].pause(); tracks[_current].currentTime = 0; }
      _current = name;
      tracks[name].play().catch(() => {});
    },
    stop() {
      if (_current) { tracks[_current].pause(); tracks[_current].currentTime = 0; }
      _current = null;
    },
    toggleMute() {
      const muted = !tracks[Object.keys(tracks)[0]].muted;
      Object.values(tracks).forEach(t => t.muted = muted);
      return muted;
    },
    get muted() { return tracks[Object.keys(tracks)[0]]?.muted ?? false; },
    get current() { return _current; }
  };
})();

function updateMusicTrack() {
  if (game.state !== 'playing') return;
  if (game.boss || difficulty.elapsed >= 120) MUSIC.play('boss');
  else if (difficulty.elapsed >= 60)          MUSIC.play('mid');
  else                                         MUSIC.play('early');
}

// ─── 6. ENTITY FACTORIES ─────────────────────────────────────
let _eid = 0;

function createEnemy(type) {
  const def  = CONFIG.enemies[type];
  const margin = def.w / 2 + 4;
  return {
    id: ++_eid, type,
    x:  margin + Math.random() * (canvas.width - margin * 2),
    y:  -def.h / 2,
    w:  def.w, h: def.h,
    speed:      def.speed * difficulty.speedScale,
    hp:         def.hp, maxHp: def.hp,
    scoreValue: def.scoreValue,
    flashTimer: 0, dead: false,
    // Size shrinks as difficulty grows (min 45% of base size)
    w: def.w * Math.max(0.45, 1.0 - difficulty.elapsed * 0.003),
    h: def.h * Math.max(0.45, 1.0 - difficulty.elapsed * 0.003),
    // Staggered fire timers so enemies don't all shoot at once
    fireTimer:    Math.random() * def.shotCooldown,
    shotCooldown: def.shotCooldown
  };
}

function createProjectile(x, offsetX = 0, damage = player.damage) {
  return {
    x: x + offsetX,
    y: player.y - CONFIG.player.renderH / 2 - 2,
    speed:           player.projectileSpeed,
    damage,
    pierceRemaining: player.canPierce ? 1 : 0,
    w: CONFIG.projectile.width,
    h: CONFIG.projectile.height
  };
}

// ─── BOSS DEFINITIONS ────────────────────────────────────────
const BOSS_DEFS = [
  {
    tier: 1, name: 'SENTINEL',
    spawnAt: 60, targetY: 115,
    hp: 40, w: 88, h: 68,
    speed: 55, color: '#ff5533', glowColor: '#ff2200',
    scoreValue: 600,
    phases: [
      { label: '— PHASE 1 —',  hpFraction: 1.1,  pattern: 'spread3',       fireRate: 0.75 },
      { label: '— RAGE —',     hpFraction: 0.5,  pattern: 'spread5',       fireRate: 1.5,  rage: true }
    ]
  },
  {
    tier: 2, name: 'DECIMATOR',
    spawnAt: 135, targetY: 125,
    hp: 90, w: 108, h: 88,
    speed: 72, color: '#cc44ff', glowColor: '#aa00ff',
    scoreValue: 1800,
    phases: [
      { label: '— PHASE 1 —',  hpFraction: 1.1,  pattern: 'aimed+spread3', fireRate: 0.9  },
      { label: '— PHASE 2 —',  hpFraction: 0.6,  pattern: 'ring8',         fireRate: 1.35 },
      { label: '— RAGE —',     hpFraction: 0.3,  pattern: 'ring8+aimed',   fireRate: 2.1,  rage: true }
    ]
  },
  {
    tier: 3, name: 'ANNIHILATOR',
    spawnAt: 225, targetY: 135,
    hp: 180, w: 130, h: 108,
    speed: 95, color: '#ff0077', glowColor: '#ff0044',
    scoreValue: 5000,
    phases: [
      { label: '— PHASE 1 —',  hpFraction: 1.1,  pattern: 'spiral',        fireRate: 1.8  },
      { label: '— PHASE 2 —',  hpFraction: 0.66, pattern: 'spiral+aimed',  fireRate: 2.5  },
      { label: '— RAGE —',     hpFraction: 0.33, pattern: 'all',           fireRate: 3.5,  rage: true }
    ]
  }
];

const UPGRADE_DEFS = {
  fireRate:   { label: 'RAPID',  maxStacks: 5,  color: '#00cfff', timed: false },
  damage:     { label: 'POWER',  maxStacks: 5,  color: '#ff5555', timed: false },
  spread:     { label: 'SPREAD', maxStacks: 99, color: '#ffaa00', timed: true  },
  doubleShot: { label: 'DUAL',   maxStacks: 1,  color: '#ffe100', timed: false },
  pierce:     { label: 'PIERCE', maxStacks: 1,  color: '#ff88ff', timed: false },
  shield:     { label: 'SHIELD', maxStacks: 3,  color: '#44ff99', timed: false },
  explosive:  { label: 'BLAST',  maxStacks: 99, color: '#ff6600', timed: true  }
};
const UPGRADE_KEYS = Object.keys(UPGRADE_DEFS);

function createPickup(x, y) {
  const available = UPGRADE_KEYS.filter(k =>
    UPGRADE_DEFS[k].timed || (player.upgrades[k] || 0) < UPGRADE_DEFS[k].maxStacks
  );
  if (!available.length) return null;
  const type = available[Math.floor(Math.random() * available.length)];
  return { x, y, type, speed: CONFIG.pickup.speed,
           w: CONFIG.pickup.width, h: CONFIG.pickup.height, spin: 0 };
}

function createExplosion(x, y, color, big = false) {
  const particles = [];
  for (let i = 0; i < CONFIG.particles.count; i++) {
    const angle = Math.PI * 2 * i / CONFIG.particles.count + (Math.random() - .5) * .7;
    const spd   = 50 + Math.random() * 100;
    particles.push({
      x, y, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd,
      life: 1.0, decay: 1.5 + Math.random() * 1.5,
      radius: 2 + Math.random() * 3, color
    });
  }
  return { type: 'explosion', x, y, color, timer: 0, duration: 0.45, particles, big };
}

function createHitFX(x, y) {
  return { type: 'hit', x, y, timer: 0, duration: 0.12 };
}

// ─── 7. INPUT UPDATE ─────────────────────────────────────────
function updateInput(dt) {
  const spd = CONFIG.player.speed;
  const mar = CONFIG.player.margin;

  // Keyboard — 4-directional
  if (keys['ArrowLeft']  || keys['KeyA']) player.x -= spd * dt;
  if (keys['ArrowRight'] || keys['KeyD']) player.x += spd * dt;
  if (keys['ArrowUp']    || keys['KeyW']) player.y -= spd * dt;
  if (keys['ArrowDown']  || keys['KeyS']) player.y += spd * dt;

  // Touch — player follows finger with upward offset
  if (touch.active) {
    const tx = touch.x;
    const ty = touch.y - 55;   // offset ship above thumb
    const dx = tx - player.x, dy = ty - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const move = Math.min(spd * 2.2 * dt, dist);
      player.x += (dx / dist) * move;
      player.y += (dy / dist) * move;
    }
  }

  // Clamp to canvas
  player.x = Math.max(mar, Math.min(canvas.width  - mar, player.x));
  player.y = Math.max(mar, Math.min(canvas.height - mar, player.y));
}

// ─── 8. PLAYER UPDATE ────────────────────────────────────────
function updatePlayer(dt) {
  player.flameLen = 8 + Math.random() * 8;
  player.fireTimer -= dt;
  if (player.fireTimer <= 0) {
    player.fireTimer = 1 / player.fireRate;
    fire();
  }
  if (player.spreadTimer   > 0) player.spreadTimer   = Math.max(0, player.spreadTimer   - dt);
  if (player.explosiveTimer > 0) player.explosiveTimer = Math.max(0, player.explosiveTimer - dt);
  for (const k of Object.keys(player.upgradeFlash)) {
    player.upgradeFlash[k] = Math.max(0, player.upgradeFlash[k] - dt * 1.8);
  }
}

function fire() {
  if (player.spreadTimer > 0) {
    // 5-bullet fan spread
    const angles = [-30, -15, 0, 15, 30];
    for (const deg of angles) {
      const rad = deg * Math.PI / 180;
      const p   = createProjectile(player.x);
      p.vx = Math.sin(rad) * p.speed;
      p.vy = -Math.cos(rad) * p.speed;
      p.spread = true;
      game.projectiles.push(p);
    }
  } else if (player.canDoubleShot) {
    // Three-shot tight cluster
    game.projectiles.push(createProjectile(player.x, -13, player.damage));
    game.projectiles.push(createProjectile(player.x,   0, player.damage));
    game.projectiles.push(createProjectile(player.x,  13, player.damage));
  } else {
    game.projectiles.push(createProjectile(player.x));
  }
  playSound('shoot');
}

// ─── 9. DIFFICULTY ───────────────────────────────────────────
function updateDifficulty(dt) {
  difficulty.elapsed      += dt;
  game.time               += dt;
  difficulty.spawnInterval = Math.max(
    CONFIG.difficulty.minSpawnInterval,
    difficulty.spawnInterval - CONFIG.difficulty.spawnDecreasePerSec * dt
  );
  // No cap — speed scales forever for infinite high-score runs
  // 0.013 gives a gentler early curve: 1.8× at 60s, 2.6× at 120s, 4.3× at 250s
  difficulty.speedScale = 1.0 + difficulty.elapsed * 0.013;

  if (difficulty.elapsed >= CONFIG.difficulty.fastUnlockTime
      && !difficulty.unlockedTypes.includes('fast'))
    difficulty.unlockedTypes.push('fast');
  if (difficulty.elapsed >= CONFIG.difficulty.tankUnlockTime
      && !difficulty.unlockedTypes.includes('tank'))
    difficulty.unlockedTypes.push('tank');
  if (difficulty.elapsed >= CONFIG.difficulty.eliteUnlockTime
      && !difficulty.unlockedTypes.includes('elite'))
    difficulty.unlockedTypes.push('elite');

  // Boss warning + spawn
  if (!game.boss && !game.bossWarning && game.nextBossTier < BOSS_DEFS.length) {
    if (difficulty.elapsed >= BOSS_DEFS[game.nextBossTier].spawnAt) {
      game.bossWarning = { tier: game.nextBossTier, timer: 3.0 };
    }
  }
  if (game.bossWarning) {
    game.bossWarning.timer -= dt;
    if (game.bossWarning.timer <= 0) {
      spawnBoss(game.bossWarning.tier);
      game.bossWarning = null;
    }
  }

  game.spawnTimer -= dt;
  if (game.spawnTimer <= 0) { spawnEnemy(); game.spawnTimer = difficulty.spawnInterval; }
}

function getEnemyPool() {
  const p = ['basic','basic','basic'];
  if (difficulty.unlockedTypes.includes('fast'))  p.push('fast','fast');
  if (difficulty.unlockedTypes.includes('tank'))  p.push('tank');
  if (difficulty.unlockedTypes.includes('elite')) p.push('elite');
  return p;
}

function spawnEnemy() {
  // Multi-spawn at high elapsed time — keeps pressure growing after spawn floor is hit
  const t = difficulty.elapsed;
  let count = 1;
  if      (t >= CONFIG.difficulty.tripleSpawnTime && Math.random() < 0.35) count = 3;
  else if (t >= CONFIG.difficulty.multiSpawnTime  && Math.random() < 0.40) count = 2;

  const pool = getEnemyPool();
  for (let i = 0; i < count; i++)
    game.enemies.push(createEnemy(pool[Math.floor(Math.random() * pool.length)]));
}

// ─── 10. PHYSICS ─────────────────────────────────────────────
function updateProjectiles(dt) {
  for (const p of game.projectiles) {
    if (p.spread) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    } else {
      p.y -= p.speed * dt;
    }
  }
}

function updateEnemies(dt) {
  const canShoot = difficulty.elapsed >= CONFIG.difficulty.enemyShotUnlockTime;
  for (const e of game.enemies) {
    e.y += e.speed * dt;
    if (e.flashTimer > 0) e.flashTimer -= dt;
    if (canShoot && e.y + e.h / 2 > 0) {
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        e.fireTimer = e.shotCooldown * (0.8 + Math.random() * 0.4); // slight jitter
        game.enemyProjectiles.push(createEnemyProjectile(e));
      }
    }
  }
}

function createEnemyProjectile(enemy) {
  const spd = CONFIG.enemyProjectile.speed * (0.9 + difficulty.speedScale * 0.15);
  let vx = 0, vy = spd;
  // Tank and elite aim toward player; basic/fast shoot straight down
  if (enemy.type === 'tank' || enemy.type === 'elite') {
    const dx = player.x - enemy.x, dy = player.y - enemy.y;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    vx = (dx / dist) * spd;
    vy = (dy / dist) * spd;
  }
  const colors = { basic:'#ff3333', fast:'#ff7700', tank:'#ff8800', elite:'#ff00ee' };
  return {
    x: enemy.x, y: enemy.y + enemy.h * 0.5,
    vx, vy,
    w: CONFIG.enemyProjectile.w,
    h: CONFIG.enemyProjectile.h,
    color: colors[enemy.type] || '#ff3333'
  };
}

function updateEnemyProjectiles(dt) {
  for (const p of game.enemyProjectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function updatePickups(dt) {
  for (const p of game.pickups) { p.y += p.speed * dt; p.spin += dt * 2.0; }
}

function updateEffects(dt) {
  for (const ef of game.effects) {
    ef.timer += dt;
    if (ef.type === 'explosion') {
      for (const p of ef.particles) {
        p.x += p.vx*dt; p.y += p.vy*dt;
        p.vx *= .88; p.vy *= .88;
        p.life -= p.decay * dt;
      }
      ef.particles = ef.particles.filter(p => p.life > 0);
    }
  }
}

// ─── 10b. BOSS ────────────────────────────────────────────────
function spawnBoss(tier) {
  const def = BOSS_DEFS[tier];
  game.boss = {
    x: canvas.width / 2, y: -def.h * 0.5,
    vx: def.speed,
    state: 'entering',
    targetY: def.targetY,
    hp: def.hp, maxHp: def.hp,
    def, phase: 0,
    fireTimer: 1.8,
    flashTimer: 0,
    spiralAngle: 0
  };
  MUSIC.play('boss');
}

function updateBoss(dt) {
  const boss = game.boss;
  if (!boss) return;
  boss.flashTimer = Math.max(0, boss.flashTimer - dt);

  if (boss.state === 'entering') {
    boss.y += 130 * dt;
    if (boss.y >= boss.targetY) { boss.y = boss.targetY; boss.state = 'active'; }
    return;
  }

  // Horizontal bounce
  boss.x += boss.vx * dt;
  const margin = boss.def.w * 0.5 + 8;
  if (boss.x > canvas.width - margin)  { boss.x = canvas.width - margin;  boss.vx = -Math.abs(boss.vx); }
  if (boss.x < margin)                 { boss.x = margin;                  boss.vx =  Math.abs(boss.vx); }

  // Fire
  boss.fireTimer -= dt;
  if (boss.fireTimer <= 0) {
    const ph = boss.def.phases[boss.phase];
    boss.fireTimer = 1 / ph.fireRate;
    fireBossPattern(boss, ph.pattern);
    playSound('shoot');
  }

  // Phase transitions
  const hpPct = boss.hp / boss.maxHp;
  const nextPhaseIdx = boss.phase + 1;
  if (nextPhaseIdx < boss.def.phases.length) {
    const ph = boss.def.phases[nextPhaseIdx];
    if (hpPct <= ph.hpFraction) {
      boss.phase = nextPhaseIdx;
      boss.flashTimer = 0.55;
      boss.fireTimer  = 0.3;
      game.effects.push(createExplosion(boss.x, boss.y, boss.def.color));
      game.bossPhaseLabel = { text: ph.label, timer: 2.2 };
    }
  }

  // Boss body → player collision
  if (rectsOverlap(boss.x, boss.y, boss.def.w * 0.7, boss.def.h * 0.7,
                   player.x, player.y, CONFIG.player.width, CONFIG.player.height)) {
    if (player.shield > 0) {
      player.shield--;
      player.upgrades.shield = Math.max(0, (player.upgrades.shield || 1) - 1);
      game.effects.push(createExplosion(player.x, player.y, '#44ff99'));
      playSound('shield');
    } else { triggerGameOver(); }
  }
}

// Boss projectile fire patterns
function fireBossPattern(boss, pattern) {
  const spd = 175 + difficulty.speedScale * 14;
  switch (pattern) {
    case 'spread3':        fireBossSpread(boss, 3, 44, spd);  break;
    case 'spread5':        fireBossSpread(boss, 5, 72, spd);  break;
    case 'aimed':          fireBossAimed (boss, spd);          break;
    case 'aimed+spread3':  fireBossSpread(boss, 3, 44, spd);  fireBossAimed(boss, spd * 1.1); break;
    case 'ring8':          fireBossRing  (boss, 8, spd * 0.8); break;
    case 'ring8+aimed':    fireBossRing  (boss, 8, spd * 0.8); fireBossAimed(boss, spd * 1.2); break;
    case 'spiral':
      boss.spiralAngle += 0.55;
      fireBossSpiral(boss, boss.spiralAngle, spd * 0.85); break;
    case 'spiral+aimed':
      boss.spiralAngle += 0.55;
      fireBossSpiral(boss, boss.spiralAngle, spd * 0.85); fireBossAimed(boss, spd); break;
    case 'all':
      fireBossSpread(boss, 5, 80, spd); fireBossRing(boss, 6, spd * 0.75); fireBossAimed(boss, spd * 1.3); break;
  }
}
function fireBossSpread(boss, count, totalDeg, spd) {
  for (let i = 0; i < count; i++) {
    const t   = count === 1 ? 0 : i / (count - 1);
    const rad = (-totalDeg / 2 + t * totalDeg) * Math.PI / 180;
    game.enemyProjectiles.push({
      x: boss.x, y: boss.y + boss.def.h * 0.38,
      vx: Math.sin(rad) * spd, vy: Math.cos(rad) * spd,
      w: 9, h: 9, color: boss.def.color, boss: true
    });
  }
}
function fireBossAimed(boss, spd) {
  const dx = player.x - boss.x, dy = player.y - boss.y;
  const d  = Math.sqrt(dx * dx + dy * dy) || 1;
  game.enemyProjectiles.push({
    x: boss.x, y: boss.y + boss.def.h * 0.38,
    vx: (dx / d) * spd, vy: (dy / d) * spd,
    w: 11, h: 11, color: boss.def.color, boss: true
  });
}
function fireBossRing(boss, count, spd) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    game.enemyProjectiles.push({
      x: boss.x, y: boss.y,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      w: 8, h: 8, color: boss.def.color, boss: true
    });
  }
}
function fireBossSpiral(boss, angle, spd) {
  for (let i = 0; i < 2; i++) {
    const a = angle + i * Math.PI;
    game.enemyProjectiles.push({
      x: boss.x, y: boss.y,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      w: 7, h: 7, color: boss.def.color, boss: true
    });
  }
}
function killBoss(boss) {
  // Score + big multi-explosion
  game.score += Math.floor(boss.def.scoreValue * player.scoreMultiplier * difficulty.speedScale);
  for (let i = 0; i < 6; i++) {
    const ox = (Math.random() - 0.5) * boss.def.w;
    const oy = (Math.random() - 0.5) * boss.def.h;
    game.effects.push(createExplosion(boss.x + ox, boss.y + oy, boss.def.color, true));
  }
  game.effects.push(createExplosion(boss.x, boss.y, '#ffffff', true));
  playSound('hit');
  // Drop 3 pickups
  for (let i = 0; i < 3; i++) {
    const pk = createPickup(boss.x + (Math.random() - 0.5) * 60, boss.y + 20 + i * 20);
    if (pk) game.pickups.push(pk);
  }
  game.nextBossTier++;
  game.boss = null;
  game.bossPhaseLabel = null;
  updateMusicTrack();
}

// ─── 11. COLLISION ───────────────────────────────────────────
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax-bx) < (aw+bw)/2 && Math.abs(ay-by) < (ah+bh)/2;
}

function checkProjectileEnemyCollisions() {
  const deadP = new Set(), deadE = new Set();
  for (let pi = 0; pi < game.projectiles.length; pi++) {
    if (deadP.has(pi)) continue;
    const proj = game.projectiles[pi];
    for (let ei = 0; ei < game.enemies.length; ei++) {
      if (deadE.has(ei)) continue;
      const e = game.enemies[ei];
      if (!rectsOverlap(proj.x, proj.y, proj.w, proj.h, e.x, e.y, e.w, e.h)) continue;

      e.hp -= proj.damage;
      e.flashTimer = 0.1;
      game.effects.push(createHitFX(proj.x, proj.y));

      if (proj.pierceRemaining > 0) { proj.pierceRemaining--; } else { deadP.add(pi); }

      if (e.hp <= 0) {
        game.score += Math.floor(e.scoreValue * player.scoreMultiplier * difficulty.speedScale);
        const col = e.type==='tank' ? '#cc44ff' : e.type==='fast' ? '#ff8800' : e.type==='elite' ? '#ff00ee' : '#ff4444';
        game.effects.push(createExplosion(e.x, e.y, col));
        playSound('hit');
        if (Math.random() < CONFIG.drops.chance) {
          const pk = createPickup(e.x, e.y);
          if (pk) { game.pickups = [pk]; }
        }
        // EXPLOSIVE power-up — AOE shockwave
        if (player.explosiveTimer > 0) {
          const R = CONFIG.powerups.explosiveRadius;
          for (let j = 0; j < game.enemies.length; j++) {
            if (deadE.has(j)) continue;
            const oe = game.enemies[j];
            const dx = oe.x - e.x, dy = oe.y - e.y;
            if (dx*dx + dy*dy < R*R) {
              oe.hp -= player.damage;
              oe.flashTimer = 0.15;
              if (oe.hp <= 0) {
                game.score += Math.floor(oe.scoreValue * player.scoreMultiplier * difficulty.speedScale);
                game.effects.push(createExplosion(oe.x, oe.y, '#ff8800'));
                deadE.add(j);
              }
            }
          }
          // Expanding ring visual
          game.effects.push({ type:'aoeRing', x:e.x, y:e.y, timer:0, duration:0.35, radius:R });
        }
        deadE.add(ei);
      }
      if (deadP.has(pi)) break;
    }
  }
  game.projectiles = game.projectiles.filter((_,i) => !deadP.has(i));
  game.enemies     = game.enemies.filter((_,i) => !deadE.has(i));
}

function checkPickupCollisions() {
  const px = player.x, py = player.y;
  const pw = CONFIG.player.width + 16, ph = CONFIG.player.height + 16; // generous hitbox
  const out = [];
  for (const p of game.pickups) {
    if (rectsOverlap(p.x, p.y, p.w, p.h, px, py, pw, ph)) {
      applyUpgrade(p.type); playSound('pickup');
    } else { out.push(p); }
  }
  game.pickups = out;
}

function checkLoseCondition() {
  const px = player.x, py = player.y;
  const pw = CONFIG.player.width, ph = CONFIG.player.height;

  for (const e of game.enemies) {
    if (!rectsOverlap(e.x, e.y, e.w, e.h, px, py, pw, ph)) continue;

    if (player.shield > 0) {
      player.shield--;
      player.upgrades.shield = Math.max(0, (player.upgrades.shield || 1) - 1);
      game.effects.push(createExplosion(e.x, e.y, '#44ff99'));
      playSound('shield');
      if (navigator.vibrate) navigator.vibrate(30);
      e.dead = true;
    } else {
      triggerGameOver(); return;
    }
  }
  game.enemies = game.enemies.filter(e => !e.dead);
}

function checkProjectileBossCollisions() {
  if (!game.boss || game.boss.state !== 'active') return;
  const boss = game.boss;
  const deadP = new Set();
  for (let pi = 0; pi < game.projectiles.length; pi++) {
    const proj = game.projectiles[pi];
    if (!rectsOverlap(proj.x, proj.y, proj.w, proj.h, boss.x, boss.y, boss.def.w * 0.88, boss.def.h * 0.82)) continue;
    boss.hp -= proj.damage;
    boss.flashTimer = 0.08;
    game.effects.push(createHitFX(proj.x, proj.y));
    if (proj.pierceRemaining > 0) { proj.pierceRemaining--; } else { deadP.add(pi); }
    if (boss.hp <= 0) { killBoss(boss); break; }
  }
  game.projectiles = game.projectiles.filter((_, i) => !deadP.has(i));
}

function checkEnemyProjectilePlayer() {
  if (game.state !== 'playing') return;
  const px = player.x, py = player.y;
  const pw = CONFIG.player.width, ph = CONFIG.player.height;
  const out = [];
  for (const p of game.enemyProjectiles) {
    if (game.state !== 'playing') { out.push(p); continue; }
    if (rectsOverlap(p.x, p.y, p.w, p.h, px, py, pw, ph)) {
      if (player.shield > 0) {
        player.shield--;
        player.upgrades.shield = Math.max(0, (player.upgrades.shield || 1) - 1);
        game.effects.push(createExplosion(px, py, '#44ff99'));
        playSound('shield');
      } else {
        triggerGameOver();
      }
    } else {
      out.push(p);
    }
  }
  game.enemyProjectiles = out;
}

function cleanupEntities() {
  game.projectiles = game.projectiles.filter(p =>
    p.y + p.h/2 > 0 && p.x > -p.w && p.x < canvas.width + p.w
  );
  game.enemies          = game.enemies.filter(e => e.y - e.h/2 < canvas.height + 20);
  game.enemyProjectiles = game.enemyProjectiles.filter(p =>
    p.y < canvas.height + 20 && p.y > -20 && p.x > -20 && p.x < canvas.width + 20
  );
  game.pickups     = game.pickups.filter(p => p.y - p.h/2 < canvas.height);
  game.effects     = game.effects.filter(ef => {
    if (ef.type === 'explosion') return ef.timer < ef.duration || ef.particles.length > 0;
    if (ef.type === 'hit')       return ef.timer < ef.duration;
    if (ef.type === 'aoeRing')   return ef.timer < ef.duration;
    return true;
  });
}

// ─── 12. UPGRADES ────────────────────────────────────────────
function applyUpgrade(type) {
  player.upgrades[type] = (player.upgrades[type] || 0) + 1;
  player.upgradeFlash[type] = 1.0;  // trigger pill glow animation
  const s = player.upgrades[type];
  switch (type) {
    case 'fireRate':   player.fireRate      = CONFIG.player.fireRate + s * 1.0; break;
    case 'damage':     player.damage        = CONFIG.player.damage   + s;       break;
    case 'spread':     player.spreadTimer    += CONFIG.powerups.spreadDuration;   break;
    case 'doubleShot': player.canDoubleShot  = true;                              break;
    case 'pierce':     player.canPierce      = true;                              break;
    case 'shield':     player.shield         = Math.min(3, player.shield + 1);    break;
    case 'explosive':  player.explosiveTimer += CONFIG.powerups.explosiveDuration; break;
  }
}

// ─── 13. STARFIELD ───────────────────────────────────────────
const stars = Array.from({ length: 100 }, () => ({
  x:     Math.random() * CONFIG.canvas.width,
  y:     Math.random() * CONFIG.canvas.height,
  r:     0.4 + Math.random() * 1.6,
  speed: 16 + Math.random() * 44,
  alpha: 0.2 + Math.random() * 0.65
}));

let bgScrollY = 0;
function updateStars(dt) {
  bgScrollY = (bgScrollY + 45 * dt) % canvas.height;
  for (const s of stars) { s.y += s.speed * dt; if (s.y > canvas.height + 2) s.y = -2; }
}

// ─── 14. RENDER — BACKGROUND ─────────────────────────────────
function renderBackground() {
  ctx.fillStyle = '#05050e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (SPRITES.bgNebula) {
    ctx.globalAlpha = 0.78;
    ctx.drawImage(SPRITES.bgNebula, 0, bgScrollY - canvas.height, canvas.width, canvas.height);
    ctx.drawImage(SPRITES.bgNebula, 0, bgScrollY,                 canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  for (const s of stars) {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle   = '#cce4ff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Subtle danger zone at bottom
function renderDangerZone() {
  ctx.fillStyle   = 'rgba(255,40,40,0.05)';
  ctx.fillRect(0, canvas.height - 54, canvas.width, 54);
  ctx.strokeStyle = 'rgba(255,40,40,0.14)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height - 54);
  ctx.lineTo(canvas.width, canvas.height - 54);
  ctx.stroke();
}

// ─── 15. RENDER — PLAYER ─────────────────────────────────────
function renderPlayer() {
  const x  = player.x;
  const y  = player.y;
  const rw = CONFIG.player.renderW;
  const rh = CONFIG.player.renderH;

  drawSprite(SPRITES.player, x, y, rw * 1.6, rh * 1.6);

  // Engine flame (keep procedural — animated)
  ctx.save();
  ctx.translate(x, y);
  const fl = player.flameLen;
  const grad = ctx.createLinearGradient(0, rh*0.38, 0, rh*0.38 + fl);
  grad.addColorStop(0, 'rgba(0,120,255,0.9)');
  grad.addColorStop(1, 'rgba(0,60,255,0)');
  ctx.fillStyle = grad;
  ctx.shadowBlur  = 12;
  ctx.shadowColor = '#0055ff';
  ctx.beginPath();
  ctx.moveTo(-rw*0.16, rh*0.38);
  ctx.lineTo( rw*0.16, rh*0.38);
  ctx.lineTo(0, rh*0.38 + fl);
  ctx.closePath();
  ctx.fill();

  // Shield ring
  if (player.shield > 0) {
    ctx.shadowBlur   = 16;
    ctx.shadowColor  = '#44ff99';
    ctx.strokeStyle  = `rgba(68,255,153,${0.45 + player.shield * 0.15})`;
    ctx.lineWidth    = 1.5 + player.shield * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, rw/2 + 10, 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── 16. RENDER — PROJECTILES ────────────────────────────────
function renderProjectiles() {
  for (const p of game.projectiles) {
    ctx.save();
    // Outer glow bolt
    ctx.shadowBlur  = 12; ctx.shadowColor = '#00ffee';
    ctx.fillStyle   = '#00ddcc';
    ctx.fillRect(p.x - p.w/2, p.y - p.h/2, p.w, p.h);
    // Bright core
    ctx.shadowBlur  = 4; ctx.shadowColor = '#ffffff';
    ctx.fillStyle   = '#eeffff';
    ctx.fillRect(p.x - p.w/4, p.y - p.h/2, p.w/2, p.h * 0.6);
    ctx.restore();
  }
}

// ─── 17. RENDER — ENEMIES ────────────────────────────────────
function renderEnemies() {
  for (const e of game.enemies) {
    const flash = e.flashTimer > 0;
    const spriteKey = e.type === 'basic'  ? 'enemyBasic'  :
                      e.type === 'fast'   ? 'enemyFast'   :
                      e.type === 'tank'   ? 'enemyTank'   :
                      e.type === 'elite'  ? 'enemyElite'  : null;
    if (spriteKey && drawSprite(SPRITES[spriteKey], e.x, e.y, e.w * 1.5, e.h * 1.5, flash)) {
      // HP bar for tank/elite
      if ((e.type === 'tank' || e.type === 'elite') && e.maxHp > 1) {
        ctx.save();
        const bw = e.w*0.88, bh = 4, bx = e.x - bw/2, by = e.y + e.h/2 + 4;
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(bx-1, by-1, bw+2, bh+2);
        ctx.fillStyle = e.type === 'elite' ? '#ff00ee' : '#bb33ff';
        ctx.fillRect(bx, by, bw * (e.hp/e.maxHp), bh);
        ctx.restore();
      }
      continue;
    }
    // Fallback: canvas primitives
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.type === 'basic') {
      ctx.shadowBlur = flash ? 22 : 10; ctx.shadowColor = flash ? '#ffffff' : '#ff3030';
      ctx.fillStyle  = flash ? '#ffffff' : '#cc2020';
      ctx.fillRect(-e.w/2, -e.h/2, e.w, e.h);
      ctx.fillStyle = flash ? '#ffcccc' : '#991010';
      ctx.fillRect(-e.w*0.3, e.h*0.1, e.w*0.6, e.h*0.4);
      ctx.fillStyle = flash ? '#ffffff' : '#cc2020';
      ctx.fillRect(-e.w/2-5, e.h*0.1, 6, 11); ctx.fillRect(e.w/2-1, e.h*0.1, 6, 11);
      ctx.fillStyle = flash ? '#ffcccc' : '#ff8888'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(-e.w*0.22, -e.h*0.1, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( e.w*0.22, -e.h*0.1, 3.5, 0, Math.PI*2); ctx.fill();
    } else if (e.type === 'fast') {
      ctx.shadowBlur = flash ? 22 : 10; ctx.shadowColor = flash ? '#ffffff' : '#ff7700';
      ctx.fillStyle  = flash ? '#ffffff' : '#dd6600';
      ctx.beginPath(); ctx.moveTo(0,-e.h/2); ctx.lineTo(e.w/2,e.h*0.15);
      ctx.lineTo(e.w*0.3,e.h/2); ctx.lineTo(-e.w*0.3,e.h/2); ctx.lineTo(-e.w/2,e.h*0.15);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = flash ? '#ffd0a0' : '#ffaa33'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(0, e.h*0.05, e.w*0.18, 0, Math.PI*2); ctx.fill();
    } else if (e.type === 'tank' || e.type === 'elite') {
      ctx.shadowBlur = flash ? 26 : 12; ctx.shadowColor = flash ? '#ffffff' : '#9922bb';
      ctx.fillStyle  = flash ? '#ffffff' : (e.type === 'elite' ? '#880099' : '#6611aa');
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI/3*i - Math.PI/6;
        i===0 ? ctx.moveTo(Math.cos(a)*e.w/2, Math.sin(a)*e.h/2)
              : ctx.lineTo(Math.cos(a)*e.w/2, Math.sin(a)*e.h/2);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = flash ? '#ffaaff' : '#cc44ff'; ctx.lineWidth = 2; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(0, 0, e.w*0.28, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = flash ? '#ffaaff' : '#ee88ff';
      ctx.beginPath(); ctx.arc(0, 0, e.w*0.1, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      const bw = e.w*0.88, bh = 4, bx = -bw/2, by = e.h/2+4;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(bx-1, by-1, bw+2, bh+2);
      ctx.fillStyle = flash ? '#ffaaff' : (e.type === 'elite' ? '#ff00ee' : '#bb33ff');
      ctx.fillRect(bx, by, bw*(e.hp/e.maxHp), bh);
    }
    ctx.restore();
  }
}

// ─── 18. RENDER — PICKUPS ────────────────────────────────────
function renderPickups() {
  const t = Date.now() / 1000;
  for (const p of game.pickups) {
    const def       = UPGRADE_DEFS[p.type];
    const spriteKey = PICKUP_SPRITE_KEYS[p.type];
    const pulse     = 0.55 + 0.45 * Math.sin(t * 4 + p.x);

    ctx.save();
    ctx.translate(p.x, p.y);

    // Outer pulse ring (keep procedural — looks great)
    ctx.globalAlpha = pulse * 0.5;
    ctx.strokeStyle = def.color; ctx.lineWidth = 1.5;
    ctx.shadowBlur  = 10; ctx.shadowColor = def.color;
    ctx.beginPath(); ctx.arc(0, 0, p.w/2 + 4, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    ctx.restore();

    if (spriteKey && SPRITES[spriteKey]) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.drawImage(SPRITES[spriteKey], -p.w, -p.h, p.w * 2, p.h * 2);
      ctx.restore();
    } else {
      // Fallback diamond
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle  = def.color; ctx.shadowBlur = 14; ctx.shadowColor = def.color;
      const r = p.w * 0.38;
      ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(r,0); ctx.lineTo(0,r); ctx.lineTo(-r,0);
      ctx.closePath(); ctx.fill();
      ctx.rotate(-p.spin);
      ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 4; ctx.shadowColor = def.color;
      ctx.font = 'bold 7px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.label[0], 0, 0);
      ctx.restore();
    }
  }
}

// ─── 19. RENDER — EFFECTS ────────────────────────────────────
function renderEffects() {
  for (const ef of game.effects) {
    const t = ef.timer / ef.duration;
    if (ef.type === 'explosion') {
      if (SPRITES.explosion) {
        const progress = Math.min(ef.timer / ef.duration, 0.9999);
        const frame = Math.min(Math.floor(progress * 8), 7);
        const alpha = progress < 0.75 ? 1 : (1 - progress) / 0.25;
        const sz    = ef.big ? 96 : 56;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(SPRITES.explosion, frame * 64, 0, 64, 64, ef.x - sz/2, ef.y - sz/2, sz, sz);
        ctx.restore();
      } else {
        for (const p of ef.particles) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle   = p.color;
          ctx.shadowBlur  = 8; ctx.shadowColor = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }
        if (ef.timer / ef.duration < 0.3) {
          const ringR = (ef.timer / ef.duration) * 50;
          ctx.save();
          ctx.globalAlpha = (0.3 - ef.timer/ef.duration) / 0.3 * 0.6;
          ctx.strokeStyle = ef.color; ctx.lineWidth = 2;
          ctx.shadowBlur  = 12; ctx.shadowColor = ef.color;
          ctx.beginPath(); ctx.arc(ef.x, ef.y, ringR, 0, Math.PI*2); ctx.stroke();
          ctx.restore();
        }
      }
    }
    if (ef.type === 'aoeRing') {
      const t = ef.timer / ef.duration;
      ctx.save();
      ctx.globalAlpha = Math.max(0, (1 - t) * 0.75);
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth   = 3 - t * 2;
      ctx.shadowBlur  = 18; ctx.shadowColor = '#ff6600';
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, ef.radius * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (ef.type === 'hit') {
      const size = 10 + t * 12;
      ctx.save();
      ctx.globalAlpha = Math.max(0, (1 - t * 2.5) * 0.8);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 8; ctx.shadowColor = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(ef.x - size/2, ef.y); ctx.lineTo(ef.x + size/2, ef.y);
      ctx.moveTo(ef.x, ef.y - size/2); ctx.lineTo(ef.x, ef.y + size/2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function renderBoss() {
  const boss = game.boss;
  if (!boss) return;
  const { x, y, def, flashTimer } = boss;
  const flash = flashTimer > 0;
  const w = def.w, h = def.h;
  const t = Date.now() / 1000;
  const pulse = 0.7 + 0.3 * Math.sin(t * 6);

  const spriteKey = BOSS_SPRITE_KEYS[def.tier - 1];
  if (drawSprite(SPRITES[spriteKey], x, y, w * 1.4, h * 1.4, flash)) {
    // Pulsing core glow overlay (keep for juice)
    if (!flash) {
      ctx.save();
      ctx.globalAlpha = pulse * 0.35;
      ctx.shadowBlur  = 30 * pulse; ctx.shadowColor = def.glowColor;
      ctx.fillStyle   = def.glowColor;
      ctx.beginPath(); ctx.arc(x, y, w * 0.1, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
    return;
  }

  // Fallback: original canvas drawing
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowBlur  = flash ? 50 : 28;
  ctx.shadowColor = flash ? '#ffffff' : def.glowColor;
  ctx.fillStyle = flash ? '#ffffff' : def.color;
  ctx.beginPath();
  ctx.moveTo(0,        -h * 0.50);
  ctx.lineTo( w * 0.38, -h * 0.18);
  ctx.lineTo( w * 0.50,  h * 0.18);
  ctx.lineTo( w * 0.28,  h * 0.50);
  ctx.lineTo(-w * 0.28,  h * 0.50);
  ctx.lineTo(-w * 0.50,  h * 0.18);
  ctx.lineTo(-w * 0.38, -h * 0.18);
  ctx.closePath();
  ctx.fill();
  if (!flash) {
    ctx.fillStyle = def.glowColor + 'aa';
    ctx.beginPath();
    ctx.moveTo(-w*0.10,-h*0.10); ctx.lineTo(-w*0.48, h*0.15);
    ctx.lineTo(-w*0.32, h*0.45); ctx.lineTo(-w*0.08, h*0.18);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo( w*0.10,-h*0.10); ctx.lineTo( w*0.48, h*0.15);
    ctx.lineTo( w*0.32, h*0.45); ctx.lineTo( w*0.08, h*0.18);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = flash ? '#ffffff' : '#222233'; ctx.shadowBlur = 0;
  ctx.fillRect(-w*0.38, h*0.08, w*0.11, h*0.34);
  ctx.fillRect( w*0.27, h*0.08, w*0.11, h*0.34);
  if (!flash) {
    ctx.shadowBlur = 12; ctx.shadowColor = def.color; ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(-w*0.325, h*0.42, w*0.045, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc( w*0.325, h*0.42, w*0.045, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 20*pulse; ctx.shadowColor = '#ffffff';
    ctx.fillStyle  = `rgba(255,255,255,${pulse*0.55})`;
    ctx.beginPath(); ctx.arc(0,0,w*0.13,0,Math.PI*2); ctx.fill();
    ctx.fillStyle  = def.color;
    ctx.beginPath(); ctx.arc(0,0,w*0.07,0,Math.PI*2); ctx.fill();
  }
  if (def.tier >= 2 && !flash) {
    ctx.shadowBlur=0; ctx.fillStyle='#222233';
    ctx.fillRect(-w*0.18,h*0.25,w*0.08,h*0.22);
    ctx.fillRect( w*0.10,h*0.25,w*0.08,h*0.22);
    ctx.shadowBlur=8; ctx.shadowColor=def.color; ctx.fillStyle=def.color;
    ctx.beginPath(); ctx.arc(-w*0.14,h*0.47,w*0.03,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc( w*0.14,h*0.47,w*0.03,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function renderBossUI() {
  // Warning flash
  if (game.bossWarning) {
    const a = 0.55 + 0.45 * Math.sin(Date.now() / 120);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowBlur  = 30; ctx.shadowColor = '#ff2200';
    ctx.fillStyle   = '#ff4422';
    ctx.font        = 'bold 22px Courier New';
    ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚠  BOSS APPROACHING  ⚠', canvas.width / 2, canvas.height / 2 - 14);
    ctx.shadowBlur = 0; ctx.fillStyle = '#ff8866'; ctx.font = '14px Courier New';
    ctx.fillText(`BRACE FOR IMPACT  ${Math.ceil(game.bossWarning.timer)}`, canvas.width / 2, canvas.height / 2 + 22);
    ctx.restore();
  }

  // Boss HP bar
  if (game.boss) {
    const boss   = game.boss;
    const barW   = canvas.width * 0.68;
    const barH   = 11;
    const bx     = (canvas.width - barW) / 2;
    const by     = 34;
    const hpPct  = Math.max(0, boss.hp / boss.maxHp);
    const barCol = hpPct > 0.5 ? '#ff4444' : hpPct > 0.25 ? '#ff8800' : '#ff0000';
    ctx.save();
    // Name
    ctx.fillStyle  = boss.def.color; ctx.shadowBlur = 8; ctx.shadowColor = boss.def.glowColor;
    ctx.font       = 'bold 10px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(boss.def.name, canvas.width / 2, by - 3);
    // Bar BG
    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by, barW + 2, barH + 2);
    // Bar fill
    ctx.fillStyle  = barCol; ctx.shadowBlur = 6; ctx.shadowColor = barCol;
    ctx.fillRect(bx, by + 1, barW * hpPct, barH);
    // Border
    ctx.shadowBlur = 0; ctx.strokeStyle = barCol + '88'; ctx.lineWidth = 1;
    ctx.strokeRect(bx, by + 1, barW, barH);
    // Phase pips
    const def = boss.def;
    for (let i = 1; i < def.phases.length; i++) {
      const px = bx + barW * def.phases[i].hpFraction;
      ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, by + 1); ctx.lineTo(px, by + barH + 1); ctx.stroke();
    }
    ctx.restore();
  }

  // Phase transition label
  if (game.bossPhaseLabel && game.bossPhaseLabel.timer > 0) {
    const alpha = Math.min(1, game.bossPhaseLabel.timer * 1.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowBlur  = 24; ctx.shadowColor = '#ff0000';
    ctx.fillStyle   = '#ff4444'; ctx.font = 'bold 20px Courier New';
    ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(game.bossPhaseLabel.text, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }
}

function renderEnemyProjectiles() {
  for (const p of game.enemyProjectiles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const angle = Math.atan2(p.vy, p.vx) - Math.PI / 2;
    ctx.rotate(angle);
    ctx.shadowBlur  = p.boss ? 14 : 8;
    ctx.shadowColor = p.color;
    ctx.fillStyle   = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.fillStyle   = '#ffffff';
    ctx.globalAlpha = 0.75;
    ctx.fillRect(-p.w / 4, -p.h / 2, p.w / 2, p.h * 0.45);
    ctx.restore();
  }
}

// ─── 20. RENDER — HUD ────────────────────────────────────────
function renderHUD() {
  ctx.save();

  // Score
  ctx.fillStyle    = '#88bbff';
  ctx.font         = 'bold 14px Courier New';
  ctx.textAlign    = 'left'; ctx.textBaseline = 'top';
  ctx.shadowBlur   = 4; ctx.shadowColor = '#0044ff';
  ctx.fillText(`${game.score}`, 12, 12);

  // Wave indicator — colour shifts red as difficulty climbs
  const wave = Math.floor(difficulty.elapsed / 20) + 1;
  ctx.textAlign = 'center';
  ctx.fillStyle = wave >= 6 ? '#ff4444' : wave >= 3 ? '#ffaa22' : '#44ffaa';
  ctx.fillText(`WAVE ${wave}`, canvas.width / 2, 12);

  // Timer
  ctx.fillStyle = '#aaccff';
  const s    = Math.floor(game.time);
  const tStr = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(tStr, canvas.width - 12, 12);

  ctx.shadowBlur = 0;

  // Active upgrade pills along the bottom
  const active = UPGRADE_KEYS.filter(k => {
    if (k === 'spread')    return player.spreadTimer > 0;
    if (k === 'explosive') return player.explosiveTimer > 0;
    return (player.upgrades[k] || 0) > 0;
  });
  if (active.length) {
    let ux = 10; const uy = canvas.height - 44;
    ctx.font = 'bold 9px Courier New'; ctx.textBaseline = 'top';
    for (const key of active) {
      const def = UPGRADE_DEFS[key], stk = player.upgrades[key];
      let lbl;
      if (key === 'spread')    lbl = `SPREAD ${Math.ceil(player.spreadTimer)}s`;
      else if (key === 'explosive') lbl = `BLAST ${Math.ceil(player.explosiveTimer)}s`;
      else lbl = stk > 1 ? `${def.label}×${stk}` : def.label;
      const lw  = ctx.measureText(lbl).width + 8;

      // Pill background — glow when freshly picked up
      const flash = player.upgradeFlash[key] || 0;
      const flashPulse = flash > 0 ? 0.5 + 0.5 * Math.sin(Date.now() / 60) : 0;
      ctx.save();
      if (flash > 0) {
        const sc = 1 + flash * 0.15;
        ctx.translate(ux - 4 + lw / 2, uy + 5.5);
        ctx.scale(sc, sc);
        ctx.translate(-(ux - 4 + lw / 2), -(uy + 5.5));
      }
      ctx.fillStyle   = flash > 0 ? def.color + '55' : def.color + '22';
      ctx.strokeStyle = flash > 0 ? def.color : def.color + '88';
      ctx.lineWidth   = flash > 0 ? 1.5 : 1;
      ctx.shadowBlur  = flash > 0 ? 12 + flashPulse * 10 : 0;
      ctx.shadowColor = def.color;
      ctx.beginPath();
      ctx.roundRect(ux - 4, uy - 2, lw, 15, 4);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle  = def.color;
      ctx.shadowBlur = flash > 0 ? 8 + flashPulse * 8 : 5;
      ctx.shadowColor = def.color;
      ctx.textAlign  = 'left';
      ctx.fillText(lbl, ux, uy);
      ctx.restore();
      ux += lw + 6;
    }
  }

  ctx.restore();
}

// ─── 21. OVERLAYS ────────────────────────────────────────────
function renderTitleOverlay() {
  ctx.fillStyle = 'rgba(5,5,14,0.58)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width/2, cy = canvas.height/2;
  ctx.textAlign='center'; ctx.textBaseline='middle';

  ctx.shadowBlur=32; ctx.shadowColor='#0088ff'; ctx.fillStyle='#22ccff';
  ctx.font='bold 38px Courier New';
  ctx.fillText('SCROLLING', cx, cy - 84);
  ctx.fillText('SHOOTER',   cx, cy - 44);

  ctx.shadowBlur=0; ctx.fillStyle='#4477aa'; ctx.font='13px Courier New';
  ctx.fillText('WASD / Arrows — move anywhere', cx, cy + 24);
  ctx.fillText('go up the screen to grab power-ups', cx, cy + 46);
  ctx.fillText('auto-fire  ·  survive as long as you can!', cx, cy + 68);

  if (game.highScore > 0) {
    ctx.fillStyle='#ffcc44'; ctx.font='12px Courier New';
    ctx.fillText(`BEST  ${game.highScore}`, cx, cy + 104);
  }

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
  ctx.globalAlpha = pulse;
  ctx.fillStyle='#ffffff'; ctx.font='bold 13px Courier New';
  ctx.fillText('SPACE  OR  CLICK  TO  START', cx, cy + 148);
  ctx.globalAlpha=1;
}

function renderGameOverOverlay() {
  ctx.fillStyle='rgba(5,5,14,0.75)'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const cx=canvas.width/2, cy=canvas.height/2;
  ctx.textAlign='center'; ctx.textBaseline='middle';

  ctx.shadowBlur=28; ctx.shadowColor='#ff2222';
  ctx.fillStyle='#ff5544'; ctx.font='bold 36px Courier New';
  ctx.fillText('GAME OVER', cx, cy - 70);
  ctx.shadowBlur=0;

  ctx.fillStyle='#aaccff'; ctx.font='bold 22px Courier New';
  ctx.fillText(`SCORE  ${game.score}`, cx, cy - 14);

  if (game.score > 0 && game.score >= game.highScore) {
    ctx.fillStyle='#ffcc44'; ctx.font='13px Courier New';
    ctx.fillText('NEW HIGH SCORE!', cx, cy + 24);
  } else if (game.highScore > 0) {
    ctx.fillStyle='#445566'; ctx.font='12px Courier New';
    ctx.fillText(`BEST  ${game.highScore}`, cx, cy + 24);
  }

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
  ctx.globalAlpha=pulse; ctx.fillStyle='#ffffff'; ctx.font='bold 13px Courier New';
  ctx.fillText('SPACE / R / CLICK  TO  RETRY', cx, cy + 72);
  ctx.globalAlpha=1;
}

function renderPauseOverlay() {
  ctx.fillStyle='rgba(5,5,14,0.6)'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowBlur=12; ctx.shadowColor='#aaaaff';
  ctx.fillStyle='#ddeeff'; ctx.font='bold 28px Courier New';
  ctx.fillText('PAUSED', canvas.width/2, canvas.height/2);
  ctx.shadowBlur=0; ctx.fillStyle='#557799'; ctx.font='13px Courier New';
  ctx.fillText('P  to resume', canvas.width/2, canvas.height/2 + 42);
}

// ─── 22. GAME LIFECYCLE ──────────────────────────────────────
function startGame() {
  game.state='playing'; game.score=0; game.time=0; game.lastTime=0;
  game.enemies=[]; game.projectiles=[]; game.enemyProjectiles=[]; game.pickups=[]; game.effects=[]; game.spawnTimer=0.6;

  player.x            = canvas.width / 2;
  player.y            = CONFIG.player.y;
  player.fireRate      = CONFIG.player.fireRate;
  player.damage        = CONFIG.player.damage;
  player.projectileSpeed = CONFIG.player.projectileSpeed;
  player.canDoubleShot  = false; player.canSpread = false; player.canPierce = false;
  player.spreadTimer    = 0; player.explosiveTimer = 0;
  player.shield         = 0; player.scoreMultiplier = 1;
  player.fireTimer      = 0; player.upgrades = {}; player.upgradeFlash = {};

  game.boss           = null;
  game.bossWarning    = null;
  game.bossPhaseLabel = null;
  game.nextBossTier   = 0;
  MUSIC.play('early');

  difficulty.elapsed       = 0;
  difficulty.spawnInterval = CONFIG.difficulty.spawnInterval;
  difficulty.speedScale    = 1.0;
  difficulty.unlockedTypes = ['basic'];
}

function triggerGameOver() {
  if (game.state !== 'playing') return;
  game.state = 'gameOver'; playSound('lose');
  MUSIC.stop();
  if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 200]);
  if (pauseBtn) pauseBtn.textContent = '⏸';
  for (const e of game.enemies) game.effects.push(createExplosion(e.x, e.y, '#ff3333'));
  game.enemies=[]; game.projectiles=[]; game.enemyProjectiles=[];
  game.boss = null; game.bossWarning = null; game.bossPhaseLabel = null;
  if (game.score > game.highScore) {
    game.highScore = game.score; localStorage.setItem('dls_hi', game.highScore);
  }
  // Show leaderboard submit after short delay
  setTimeout(() => LB.onGameOver(game.score, Math.floor(difficulty.elapsed / 20) + 1, Math.floor(game.time)), 1200);
}

// ─── 23. MAIN LOOP ───────────────────────────────────────────
function update(dt) {
  updateStars(dt);
  if (game.state === 'playing') {
    updateInput(dt); updatePlayer(dt); updateDifficulty(dt);
    updateProjectiles(dt); updateEnemies(dt); updateEnemyProjectiles(dt); updateBoss(dt); updatePickups(dt); updateEffects(dt);
    if (game.bossPhaseLabel) { game.bossPhaseLabel.timer -= dt; if (game.bossPhaseLabel.timer <= 0) game.bossPhaseLabel = null; }
    checkProjectileEnemyCollisions(); checkProjectileBossCollisions(); checkPickupCollisions(); checkLoseCondition(); checkEnemyProjectilePlayer();
    updateMusicTrack();
    cleanupEntities();
  } else if (game.state === 'gameOver') {
    updateEffects(dt);
    game.effects = game.effects.filter(ef => ef.type !== 'explosion' || ef.timer < ef.duration);
  }
}

function render() {
  renderBackground();
  if (game.state === 'title') { renderTitleOverlay(); return; }
  renderDangerZone();
  renderPlayer();
  renderProjectiles();
  renderEnemyProjectiles();
  renderBoss();
  renderEnemies();
  renderPickups();
  renderEffects();
  renderBossUI();
  renderHUD();
  if (game.state === 'gameOver') renderGameOverOverlay();
  if (game.state === 'paused')   renderPauseOverlay();
}

function gameLoop(timestamp) {
  if (game.lastTime === 0) game.lastTime = timestamp;
  const dt = Math.min((timestamp - game.lastTime) / 1000, 0.05);
  game.lastTime = timestamp;
  update(dt); render();
  requestAnimationFrame(gameLoop);
}

loadSprites().then(() => requestAnimationFrame(gameLoop));

// ─── LEADERBOARD ─────────────────────────────────────────────
const GAME_VERSION = '1.0';

const LB = (() => {
  let _db = null;
  let _lastScore = 0, _lastWave = 0, _submitted = false;

  const overlay    = document.getElementById('lb-overlay');
  const nameRow    = document.getElementById('lb-name-row');
  const nameInput  = document.getElementById('lb-name-input');
  const submitBtn  = document.getElementById('lb-submit');
  const submitStatus = document.getElementById('lb-submit-status');
  const closeBtn   = document.getElementById('lb-close');
  const loading    = document.getElementById('lb-loading');
  const table      = document.getElementById('lb-table');
  const tbody      = document.getElementById('lb-body');

  const COL = `scores_v${GAME_VERSION.replace('.','_')}`;
  const NAME_KEY = 'lb_player_name';

  function init() {
    try {
      if (typeof firebase === 'undefined') { console.error('LB: firebase SDK not loaded'); return; }
      if (typeof FIREBASE_CONFIG === 'undefined' || FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') { console.error('LB: no config'); return; }
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
      _db = app.firestore();
      console.log('LB: Firestore ready');
    } catch(e) { console.error('LB: Firebase init failed:', e.message); }
  }

  function escHTML(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  async function loadScores() {
    if (!_db) { loading.textContent = 'Scores unavailable'; return; }
    loading.style.display = 'block';
    table.classList.add('hidden');
    try {
      const snap = await _db.collection(COL).orderBy('score','desc').limit(10).get();
      tbody.innerHTML = '';
      const savedName = (localStorage.getItem(NAME_KEY) || '').toUpperCase();
      snap.docs.forEach((doc, i) => {
        const d = doc.data();
        const tr = document.createElement('tr');
        if (savedName && (d.name || '').toUpperCase() === savedName && d.score === _lastScore) {
          tr.className = 'mine';
        }
        tr.innerHTML =
          `<td class="lb-rank">${i+1}</td>` +
          `<td>${escHTML(d.name || 'ACE')}</td>` +
          `<td class="lb-score-val">${Number(d.score).toLocaleString()}</td>` +
          `<td class="lb-wave-val">${d.wave}</td>`;
        tbody.appendChild(tr);
      });
      if (snap.empty) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:#445566;padding:10px 6px">No scores yet — be the first!</td></tr>';
      }
      loading.style.display = 'none';
      table.classList.remove('hidden');
    } catch(e) { loading.textContent = 'Could not load scores'; }
  }

  async function submit() {
    if (_submitted) return;
    if (!_db) { submitStatus.textContent = 'Not connected — refresh page'; return; }
    const raw = (nameInput.value || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 12);
    const name = raw || 'ACE';
    submitBtn.disabled = true;
    submitStatus.textContent = 'Submitting…';
    try {
      await _db.collection(COL).add({
        name, score: _lastScore, wave: _lastWave,
        version: GAME_VERSION, ts: Date.now()
      });
      localStorage.setItem(NAME_KEY, name);
      _submitted = true;
      submitStatus.textContent = '✓ Score saved!';
      submitBtn.style.display = 'none';
      nameRow.classList.add('hidden');
      loadScores();
    } catch(e) {
      submitStatus.textContent = 'Submit failed — try again';
      submitBtn.disabled = false;
    }
  }

  function show() {
    overlay && overlay.classList.remove('hidden');
    loadScores();
  }
  function hide() { overlay && overlay.classList.add('hidden'); }

  // Pre-fill name from last session
  if (nameInput) {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) nameInput.value = saved;
    nameInput.addEventListener('input', () => {
      nameInput.value = nameInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  submitBtn?.addEventListener('click', submit);
  closeBtn ?.addEventListener('click', hide);
  overlay  ?.addEventListener('click', e => { if (e.target === overlay) hide(); });

  return {
    init,
    onGameOver(score, wave) {
      _lastScore = score; _lastWave = wave; _submitted = false;
      if (submitBtn)  { submitBtn.disabled = false; submitBtn.style.display = ''; }
      if (submitStatus) submitStatus.textContent = '';
      if (nameRow)    nameRow.classList.remove('hidden');
      show();
    }
  };
})();

LB.init();
