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
    basic: { hp:1, speed:82,  scoreValue:10, w:32, h:32 },
    fast:  { hp:1, speed:165, scoreValue:15, w:24, h:24 },
    tank:  { hp:4, speed:48,  scoreValue:30, w:44, h:44 }
  },

  drops:  { chance: 0.27 },
  pickup: { width:20, height:20, speed:56 },

  difficulty: {
    spawnInterval:       1.4,
    minSpawnInterval:    0.22,
    spawnDecreasePerSec: 0.007,
    speedScaleMax:       2.4,
    fastUnlockTime:      10,
    tankUnlockTime:      26
  },

  particles: { count: 10 }
};

// ─── 2. CANVAS ───────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
canvas.width  = CONFIG.canvas.width;
canvas.height = CONFIG.canvas.height;

// ─── 3. GAME STATE ───────────────────────────────────────────
const game = {
  state:      'title',
  score:      0,
  highScore:  parseInt(localStorage.getItem('dls_hi') || '0'),
  time:       0,
  lastTime:   0,
  enemies:    [],
  projectiles:[],
  pickups:    [],
  effects:    [],
  spawnTimer: 0
};

const player = {
  x:               CONFIG.canvas.width / 2,
  fireRate:        CONFIG.player.fireRate,
  damage:          CONFIG.player.damage,
  projectileSpeed: CONFIG.player.projectileSpeed,
  canDoubleShot:   false,
  canSpread:       false,
  canPierce:       false,
  shield:          0,
  scoreMultiplier: 1,
  fireTimer:       0,
  upgrades:        {},
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
    flashTimer: 0, dead: false
  };
}

function createProjectile(x, offsetX = 0, damage = player.damage) {
  return {
    x: x + offsetX,
    y: CONFIG.player.y - CONFIG.player.renderH / 2 - 2,
    speed:           player.projectileSpeed,
    damage,
    pierceRemaining: player.canPierce ? 1 : 0,
    w: CONFIG.projectile.width,
    h: CONFIG.projectile.height
  };
}

const UPGRADE_DEFS = {
  fireRate:   { label: 'RAPID',  maxStacks: 5, color: '#00cfff' },
  damage:     { label: 'POWER',  maxStacks: 5, color: '#ff5555' },
  spread:     { label: 'SPREAD', maxStacks: 1, color: '#ffaa00' },
  doubleShot: { label: 'DUAL',   maxStacks: 1, color: '#ffe100' },
  pierce:     { label: 'PIERCE', maxStacks: 1, color: '#ff88ff' },
  shield:     { label: 'SHIELD', maxStacks: 3, color: '#44ff99' }
};
const UPGRADE_KEYS = Object.keys(UPGRADE_DEFS);

function createPickup(x, y) {
  const available = UPGRADE_KEYS.filter(k =>
    (player.upgrades[k] || 0) < UPGRADE_DEFS[k].maxStacks
  );
  if (!available.length) return null;
  const type = available[Math.floor(Math.random() * available.length)];
  return { x, y, type, speed: CONFIG.pickup.speed,
           w: CONFIG.pickup.width, h: CONFIG.pickup.height, spin: 0 };
}

function createExplosion(x, y, color) {
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
  return { type: 'explosion', x, y, color, timer: 0, duration: 0.45, particles };
}

function createHitFX(x, y) {
  return { type: 'hit', x, y, timer: 0, duration: 0.12 };
}

// ─── 7. INPUT UPDATE ─────────────────────────────────────────
function updateInput(dt) {
  const spd = CONFIG.player.speed;
  const mar = CONFIG.player.margin;
  if (keys['ArrowLeft']  || keys['KeyA']) player.x -= spd * dt;
  if (keys['ArrowRight'] || keys['KeyD']) player.x += spd * dt;
  player.x = Math.max(mar, Math.min(canvas.width - mar, player.x));
}

// ─── 8. PLAYER UPDATE ────────────────────────────────────────
function updatePlayer(dt) {
  player.flameLen = 8 + Math.random() * 8;
  player.fireTimer -= dt;
  if (player.fireTimer <= 0) {
    player.fireTimer = 1 / player.fireRate;
    fire();
  }
}

function fire() {
  if (player.canSpread) {
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
  difficulty.speedScale = Math.min(
    CONFIG.difficulty.speedScaleMax,
    1.0 + difficulty.elapsed * 0.016
  );
  if (difficulty.elapsed >= CONFIG.difficulty.fastUnlockTime
      && !difficulty.unlockedTypes.includes('fast'))
    difficulty.unlockedTypes.push('fast');
  if (difficulty.elapsed >= CONFIG.difficulty.tankUnlockTime
      && !difficulty.unlockedTypes.includes('tank'))
    difficulty.unlockedTypes.push('tank');

  game.spawnTimer -= dt;
  if (game.spawnTimer <= 0) { spawnEnemy(); game.spawnTimer = difficulty.spawnInterval; }
}

function getEnemyPool() {
  const p = ['basic','basic','basic'];
  if (difficulty.unlockedTypes.includes('fast')) p.push('fast','fast');
  if (difficulty.unlockedTypes.includes('tank')) p.push('tank');
  return p;
}

function spawnEnemy() {
  const pool = getEnemyPool();
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
  for (const e of game.enemies) {
    e.y += e.speed * dt;
    if (e.flashTimer > 0) e.flashTimer -= dt;
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
        game.score += Math.floor(e.scoreValue * player.scoreMultiplier);
        const col = e.type==='tank' ? '#cc44ff' : e.type==='fast' ? '#ff8800' : '#ff4444';
        game.effects.push(createExplosion(e.x, e.y, col));
        playSound('hit');
        if (Math.random() < CONFIG.drops.chance) {
          const pk = createPickup(e.x, e.y);
          if (pk) { game.pickups = [pk]; } // only one pickup on screen at a time
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
  const px = player.x, py = CONFIG.player.y;
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
  const px = player.x, py = CONFIG.player.y;
  const pw = CONFIG.player.width, ph = CONFIG.player.height;

  for (const e of game.enemies) {
    if (!rectsOverlap(e.x, e.y, e.w, e.h, px, py, pw, ph)) continue;

    if (player.shield > 0) {
      player.shield--;
      player.upgrades.shield = Math.max(0, (player.upgrades.shield || 1) - 1);
      game.effects.push(createExplosion(e.x, e.y, '#44ff99'));
      playSound('shield');
      e.dead = true;
    } else {
      triggerGameOver(); return;
    }
  }
  game.enemies = game.enemies.filter(e => !e.dead);
}

function cleanupEntities() {
  game.projectiles = game.projectiles.filter(p =>
    p.y + p.h/2 > 0 && p.x > -p.w && p.x < canvas.width + p.w
  );
  game.enemies     = game.enemies.filter(e => e.y - e.h/2 < canvas.height + 20);
  game.pickups     = game.pickups.filter(p => p.y - p.h/2 < canvas.height);
  game.effects     = game.effects.filter(ef => {
    if (ef.type === 'explosion') return ef.timer < ef.duration || ef.particles.length > 0;
    if (ef.type === 'hit')       return ef.timer < ef.duration;
    return true;
  });
}

// ─── 12. UPGRADES ────────────────────────────────────────────
function applyUpgrade(type) {
  player.upgrades[type] = (player.upgrades[type] || 0) + 1;
  const s = player.upgrades[type];
  switch (type) {
    case 'fireRate':   player.fireRate      = CONFIG.player.fireRate + s * 1.0; break;
    case 'damage':     player.damage        = CONFIG.player.damage   + s;       break;
    case 'spread':     player.canSpread      = true;                             break;
    case 'doubleShot': player.canDoubleShot = true;                             break;
    case 'pierce':     player.canPierce     = true;                             break;
    case 'shield':     player.shield        = Math.min(3, player.shield + 1);   break;
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

function updateStars(dt) {
  for (const s of stars) { s.y += s.speed * dt; if (s.y > canvas.height + 2) s.y = -2; }
}

// ─── 14. RENDER — BACKGROUND ─────────────────────────────────
function renderBackground() {
  ctx.fillStyle = '#05050e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  const y  = CONFIG.player.y;
  const rw = CONFIG.player.renderW;
  const rh = CONFIG.player.renderH;

  ctx.save();
  ctx.translate(x, y);

  // Engine flame
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

  // Hull
  ctx.shadowBlur  = 16;
  ctx.shadowColor = '#00aaff';
  ctx.fillStyle   = '#1ab8f5';
  ctx.beginPath();
  ctx.moveTo(0,       -rh/2);
  ctx.lineTo(-rw/2,    rh/2 - 4);
  ctx.lineTo(-rw/5,    rh/3);
  ctx.lineTo(0,        rh/2 - 8);
  ctx.lineTo( rw/5,    rh/3);
  ctx.lineTo( rw/2,    rh/2 - 4);
  ctx.closePath();
  ctx.fill();

  // Wing accent
  ctx.fillStyle = '#0077cc';
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(-rw*0.42, rh*0.3);
  ctx.lineTo(-rw*0.18, rh*0.05);
  ctx.lineTo(-rw*0.18, rh*0.32);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo( rw*0.42, rh*0.3);
  ctx.lineTo( rw*0.18, rh*0.05);
  ctx.lineTo( rw*0.18, rh*0.32);
  ctx.closePath(); ctx.fill();

  // Cockpit
  ctx.shadowBlur  = 8;
  ctx.shadowColor = '#aaeeff';
  ctx.fillStyle   = '#88eeff';
  ctx.beginPath();
  ctx.ellipse(0, -rh*0.12, 6, 9, 0, 0, Math.PI*2);
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
    ctx.shadowBlur  = 10;
    ctx.shadowColor = '#00ffee';
    ctx.fillStyle   = '#00ddcc';
    ctx.fillRect(p.x - p.w/2, p.y - p.h/2, p.w, p.h);
    // Bright core
    ctx.fillStyle   = '#eeffff';
    ctx.shadowBlur  = 4;
    ctx.fillRect(p.x - p.w/4, p.y - p.h/2, p.w/2, p.h * 0.55);
    ctx.restore();
  }
}

// ─── 17. RENDER — ENEMIES ────────────────────────────────────
function renderEnemies() {
  for (const e of game.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const flash = e.flashTimer > 0;

    if (e.type === 'basic') {
      // Chunky red invader
      ctx.shadowBlur  = flash ? 22 : 10;
      ctx.shadowColor = flash ? '#ffffff' : '#ff3030';
      ctx.fillStyle   = flash ? '#ffffff' : '#cc2020';

      // Body
      ctx.fillRect(-e.w/2, -e.h/2, e.w, e.h);
      // Under-panel
      ctx.fillStyle = flash ? '#ffcccc' : '#991010';
      ctx.fillRect(-e.w*0.3, e.h*0.1, e.w*0.6, e.h*0.4);
      // Side guns
      ctx.fillStyle = flash ? '#ffffff' : '#cc2020';
      ctx.fillRect(-e.w/2 - 5, e.h*0.1, 6, 11);
      ctx.fillRect( e.w/2 - 1, e.h*0.1, 6, 11);
      // Eye lights
      ctx.fillStyle = flash ? '#ffcccc' : '#ff8888';
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(-e.w*0.22, -e.h*0.1, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( e.w*0.22, -e.h*0.1, 3.5, 0, Math.PI*2); ctx.fill();

    } else if (e.type === 'fast') {
      // Sleek orange diamond
      ctx.shadowBlur  = flash ? 22 : 10;
      ctx.shadowColor = flash ? '#ffffff' : '#ff7700';
      ctx.fillStyle   = flash ? '#ffffff' : '#dd6600';
      ctx.beginPath();
      ctx.moveTo(0,     -e.h/2);
      ctx.lineTo(e.w/2,  e.h*0.15);
      ctx.lineTo(e.w*0.3,e.h/2);
      ctx.lineTo(-e.w*0.3,e.h/2);
      ctx.lineTo(-e.w/2, e.h*0.15);
      ctx.closePath();
      ctx.fill();
      // Core gem
      ctx.fillStyle   = flash ? '#ffd0a0' : '#ffaa33';
      ctx.shadowBlur  = 6;
      ctx.beginPath(); ctx.arc(0, e.h*0.05, e.w*0.18, 0, Math.PI*2); ctx.fill();

    } else if (e.type === 'tank') {
      // Heavy purple hexagon
      ctx.shadowBlur  = flash ? 26 : 12;
      ctx.shadowColor = flash ? '#ffffff' : '#9922bb';
      ctx.fillStyle   = flash ? '#ffffff' : '#6611aa';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI/3*i - Math.PI/6;
        i===0 ? ctx.moveTo(Math.cos(a)*e.w/2, Math.sin(a)*e.h/2)
              : ctx.lineTo(Math.cos(a)*e.w/2, Math.sin(a)*e.h/2);
      }
      ctx.closePath(); ctx.fill();
      // Inner ring
      ctx.strokeStyle = flash ? '#ffaaff' : '#cc44ff';
      ctx.lineWidth   = 2; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(0, 0, e.w*0.28, 0, Math.PI*2); ctx.stroke();
      // Centre dot
      ctx.fillStyle = flash ? '#ffaaff' : '#ee88ff';
      ctx.beginPath(); ctx.arc(0, 0, e.w*0.1, 0, Math.PI*2); ctx.fill();

      // HP bar
      ctx.shadowBlur = 0;
      const bw = e.w*0.88, bh = 4, bx = -bw/2, by = e.h/2 + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(bx-1, by-1, bw+2, bh+2);
      ctx.fillStyle = flash ? '#ffaaff' : '#bb33ff';
      ctx.fillRect(bx, by, bw * (e.hp/e.maxHp), bh);
    }

    ctx.restore();
  }
}

// ─── 18. RENDER — PICKUPS ────────────────────────────────────
function renderPickups() {
  const t = Date.now() / 1000;
  for (const p of game.pickups) {
    const def = UPGRADE_DEFS[p.type];
    ctx.save();
    ctx.translate(p.x, p.y);

    // Outer pulse ring
    const pulse = 0.55 + 0.45 * Math.sin(t * 4 + p.x);
    ctx.globalAlpha = pulse * 0.5;
    ctx.strokeStyle = def.color;
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 10; ctx.shadowColor = def.color;
    ctx.beginPath(); ctx.arc(0, 0, p.w/2 + 4, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;

    // Rotating diamond
    ctx.rotate(p.spin);
    ctx.fillStyle   = def.color;
    ctx.shadowBlur  = 14; ctx.shadowColor = def.color;
    const r = p.w * 0.38;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
    ctx.closePath(); ctx.fill();

    // Label (un-rotate)
    ctx.rotate(-p.spin);
    ctx.fillStyle     = '#ffffff';
    ctx.shadowBlur    = 4; ctx.shadowColor = def.color;
    ctx.font          = 'bold 7px Courier New';
    ctx.textAlign     = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.label[0], 0, 0);

    ctx.restore();
  }
}

// ─── 19. RENDER — EFFECTS ────────────────────────────────────
function renderEffects() {
  for (const ef of game.effects) {
    const t = ef.timer / ef.duration;
    if (ef.type === 'explosion') {
      for (const p of ef.particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle   = p.color;
        ctx.shadowBlur  = 8; ctx.shadowColor = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
      // Central flash ring
      if (t < 0.3) {
        const ringR = t * 50;
        ctx.save();
        ctx.globalAlpha = (0.3 - t) / 0.3 * 0.6;
        ctx.strokeStyle = ef.color;
        ctx.lineWidth   = 2;
        ctx.shadowBlur  = 12; ctx.shadowColor = ef.color;
        ctx.beginPath(); ctx.arc(ef.x, ef.y, ringR, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
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

// ─── 20. RENDER — HUD ────────────────────────────────────────
function renderHUD() {
  ctx.save();

  // Score
  ctx.fillStyle    = '#88bbff';
  ctx.font         = 'bold 14px Courier New';
  ctx.textAlign    = 'left'; ctx.textBaseline = 'top';
  ctx.shadowBlur   = 4; ctx.shadowColor = '#0044ff';
  ctx.fillText(`${game.score}`, 12, 12);

  // Timer
  const s    = Math.floor(game.time);
  const tStr = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(tStr, canvas.width - 12, 12);

  ctx.shadowBlur = 0;

  // Active upgrade pills along the bottom
  const active = UPGRADE_KEYS.filter(k => player.upgrades[k] > 0);
  if (active.length) {
    let ux = 10; const uy = canvas.height - 44;
    ctx.font = 'bold 9px Courier New'; ctx.textBaseline = 'top';
    for (const key of active) {
      const def = UPGRADE_DEFS[key], stk = player.upgrades[key];
      const lbl = stk > 1 ? `${def.label}×${stk}` : def.label;
      const lw  = ctx.measureText(lbl).width + 8;

      // Pill background
      ctx.fillStyle   = def.color + '22';
      ctx.strokeStyle = def.color + '88';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.roundRect(ux - 4, uy - 2, lw, 15, 4);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle   = def.color;
      ctx.shadowBlur  = 5; ctx.shadowColor = def.color;
      ctx.textAlign   = 'left';
      ctx.fillText(lbl, ux, uy);
      ctx.shadowBlur  = 0;
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
  ctx.fillText('A / D  or  ← →  to move', cx, cy + 24);
  ctx.fillText('auto-fire  ·  collect upgrades', cx, cy + 46);
  ctx.fillText('don\'t let them through!', cx, cy + 68);

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
  game.enemies=[]; game.projectiles=[]; game.pickups=[]; game.effects=[]; game.spawnTimer=0.6;

  player.x            = canvas.width / 2;
  player.fireRate      = CONFIG.player.fireRate;
  player.damage        = CONFIG.player.damage;
  player.projectileSpeed = CONFIG.player.projectileSpeed;
  player.canDoubleShot = false; player.canSpread = false; player.canPierce = false;
  player.shield        = 0; player.scoreMultiplier = 1;
  player.fireTimer     = 0; player.upgrades = {};

  difficulty.elapsed       = 0;
  difficulty.spawnInterval = CONFIG.difficulty.spawnInterval;
  difficulty.speedScale    = 1.0;
  difficulty.unlockedTypes = ['basic'];
}

function triggerGameOver() {
  if (game.state !== 'playing') return;
  game.state = 'gameOver'; playSound('lose');
  for (const e of game.enemies) game.effects.push(createExplosion(e.x, e.y, '#ff3333'));
  game.enemies=[]; game.projectiles=[];
  if (game.score > game.highScore) {
    game.highScore = game.score; localStorage.setItem('dls_hi', game.highScore);
  }
}

// ─── 23. MAIN LOOP ───────────────────────────────────────────
function update(dt) {
  updateStars(dt);
  if (game.state === 'playing') {
    updateInput(dt); updatePlayer(dt); updateDifficulty(dt);
    updateProjectiles(dt); updateEnemies(dt); updatePickups(dt); updateEffects(dt);
    checkProjectileEnemyCollisions(); checkPickupCollisions(); checkLoseCondition();
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
  renderEnemies();
  renderPickups();
  renderEffects();
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

requestAnimationFrame(gameLoop);
