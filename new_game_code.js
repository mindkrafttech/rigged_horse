import * as THREE from 'three';

/* =========================================================================
   CLEAR THE COURSE — Three.js 2.5D HORSE JUMP GAME
   Horse sprite + 3D environment hybrid
   ========================================================================= */

/* ----------------------------- GAME CONFIG -------------------------------- */
/* =========================================================================
   CENTRAL BUSINESS & GAMEPLAY CONFIGURATIONS
   (Easy tuning for promotional reward rules, timer, difficulty & course)
   ========================================================================= */

const TIMER_CONFIG = {
  enabled: true,
  initialSeconds: 40.0,
  warningSeconds: 10.0,
  criticalSeconds: 5.0,
  timeoutRewardMode: 'achieved_no_bonus', // 'achieved_no_bonus' | 'zero'
};

const DERBY_CONFIG = {
  eventName: "CHAMPIONSHIP DERBY",
  cupName: "GRAND DERBY CUP",
  year: "2026",
  banners: ["CHAMPIONSHIP DERBY", "GRAND DERBY CUP 2026", "FINAL RACE 2026", "DERBY CHAMPIONS"],
};

const REWARD_CONFIG = {
  minimum: 0,                   // Minimum discount (0% if 1st hurdle missed)
  maximum: 20,                  // MAXIMUM DISCOUNT CAP IS NOW 20% OFF!
  discountPerHurdle: 1,         // 1% discount for each hurdle successfully cleared!
  firstHurdleRequired: true,    // Failing 1st hurdle = 0% reward!
};

const GC = {
  world: {
    horseX: 0,        // horse fixed world X
    groundY: 0,       // ground plane Y
    spawnX: 34,       // hurdle spawn X ahead of horse
    recycleX: -14,    // hurdle recycled when past here
  },
  player: {
    jumpVelocity: 12.5,   // punchy upward velocity
    gravity: 32,           // ultra high gravity for millisecond jump timing window
    runFrameTime: 0.040,   // ultra fast gallop frame
    idleFrameTime: 0.38,
    horseHeight: 3.4,      // majestic horse height
    horseAspect: 1.55,     // sprite width/height ratio
    gracePeriod: 0.35,     // immediate timing requirement for 1st hurdle
  },
  collision: {
    horseBoxY0: 0.35, // collision box bottom
    horseBoxY1: 2.8,  // collision box top
    hurdleHalfX: 0.45, // hurdle collision half-width in X
  },
  progression: {
    hurdlesToWin: 20,   // 20 cleared hurdles = 100% course progress = 20% MAX discount
    totalHurdles: 20,   // 20 hurdles total on course
    hardModeUnlock: 50,
    completion: 100,
  },
  difficulty: [
    // Hurdles 1–5 (Progress 0–25%): 🟢 EASY MODE
    { minPct: 0,   speed: 18.5, gapMs: [2100, 2400], railH: 1.45, name: '🟢 EASY MODE', color: '#4CAF50' },
    // Hurdles 6–10 (Progress 26–50%): 🟡 NORMAL MODE
    { minPct: 26,  speed: 21.5, gapMs: [1750, 2000], railH: 1.50, name: '🟡 NORMAL MODE', color: '#e8a838' },
    // Hurdles 11–15 (Progress 51–75%): 🟠 HARD MODE
    { minPct: 51,  speed: 25.0, gapMs: [1400, 1650], railH: 1.55, name: '🟠 HARD MODE', color: '#ff9933' },
    // Hurdles 16–20 (Progress 76–100%): 🔴 EXPERT MODE
    { minPct: 76,  speed: 28.5, gapMs: [1100, 1300], railH: 1.60, name: '🔴 EXPERT MODE', color: '#ff4d4d' },
  ],
};

/* ----------------------------- GAME STATES -------------------------------- */
const STATE = { START: 0, PLAYING: 1, GAME_OVER: 2, VICTORY: 3, TIMEOUT: 4, PAUSED: 5 };
const ANIM  = { IDLE: 0, RUN: 1, JUMP: 2, HIT: 3 };

/* ----------------------------- SOUND -------------------------------------- */
const Sound = (() => {
  let ctx = null;
  let muted = false;
  let gallopTimer = 0;
  
  // Optional audio element for custom gallop/music files
  let customGallopAudio = null;
  let customMusicAudio = null;
  let hasCustomGallop = false;
  let hasCustomMusic = false;

  function ensure() {
    if (!ctx) { 
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} 
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type='sine', gain=0.16, delay=0) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    try {
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator(); const g = c.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
      osc.connect(g).connect(c.destination); osc.start(t0); osc.stop(t0+dur+0.02);
    } catch(e){}
  }

  // Synthesis of a single realistic horse hoofbeat on dirt/turf
  function playHoofbeat(weight = 1.0, pitch = 1.0, delay = 0) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    try {
      const t0 = c.currentTime + delay;
      
      // 1. Low thud (deep bass sweep simulating heavy hoof impact)
      const osc = c.createOscillator();
      const oscGain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160 * pitch, t0);
      osc.frequency.exponentialRampToValueAtTime(35, t0 + 0.045);
      oscGain.gain.setValueAtTime(0.35 * weight, t0);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      osc.connect(oscGain).connect(c.destination);
      osc.start(t0); osc.stop(t0 + 0.055);

      // 2. Dirt crunch (bandpass filtered noise burst for turf scatter)
      const bufferSize = Math.floor(c.sampleRate * 0.04);
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
      }
      const noise = c.createBufferSource();
      noise.buffer = buffer;

      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100 * pitch, t0);
      filter.Q.setValueAtTime(1.8, t0);

      const noiseGain = c.createGain();
      noiseGain.gain.setValueAtTime(0.22 * weight, t0);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);

      noise.connect(filter).connect(noiseGain).connect(c.destination);
      noise.start(t0); noise.stop(t0 + 0.045);
    } catch(e){}
  }

  return {
    jump() { 
      this.stopGallop();
      tone(520,0.14,'triangle',0.14); 
      tone(760,0.1,'triangle',0.08,0.03); 
    },
    land() {
      // Double hoof impact when landing from jump
      playHoofbeat(1.4, 0.9, 0);
      playHoofbeat(1.2, 1.05, 0.05);
    },
    clear()   { tone(880,0.12,'sine',0.14); tone(1160,0.14,'sine',0.12,0.06); },
    hit()     { 
      this.stopGallop();
      tone(160,0.35,'sawtooth',0.18); 
      tone(90,0.4,'square',0.12,0.05); 
    },
    hardMode(){ tone(300,0.15,'square',0.12); tone(450,0.15,'square',0.12,0.12); tone(600,0.22,'square',0.14,0.24); },
    victory() { 
      this.stopGallop();
      [523,659,784,1046].forEach((f,i)=>tone(f,0.28,'sine',0.15,i*0.11)); 
    },

    updateGallop(dt, speed) {
      if (muted) return;

      // If custom audio file provided, play that instead!
      if (hasCustomGallop && customGallopAudio) {
        if (customGallopAudio.paused) customGallopAudio.play().catch(()=>{});
        return;
      }

      // Procedural gallop rhythm engine (3-beat gallop gait)
      const strideDuration = Math.max(0.24, 0.46 - (speed - 8) * 0.012);
      gallopTimer += dt;
      if (gallopTimer >= strideDuration) {
        gallopTimer = 0;
        playHoofbeat(0.8, 0.95, 0);
        playHoofbeat(1.0, 1.05, strideDuration * 0.22);
        playHoofbeat(0.75, 1.15, strideDuration * 0.42);
      }
    },

    stopGallop() {
      gallopTimer = 0;
      if (customGallopAudio && !customGallopAudio.paused) {
        customGallopAudio.pause();
        customGallopAudio.currentTime = 0;
      }
    },

    startMusic() {
      if (muted) return;
      if (hasCustomMusic && customMusicAudio && customMusicAudio.paused) {
        customMusicAudio.play().catch(()=>{});
      }
    },

    stopMusic() {
      if (customMusicAudio && !customMusicAudio.paused) {
        customMusicAudio.pause();
        customMusicAudio.currentTime = 0;
      }
    },

    setMuted(v) { 
      muted = v; 
      if (muted) {
        this.stopGallop();
        this.stopMusic();
      }
    },

    isMuted() { return muted; },
  };
})();

/* ----------------------------- REWARD FORMULA ----------------------------- */
function calculateReward(progress, elapsedTime = 0, remainingTime = 40, stats = {}) {
  const cleared     = (stats && stats.hurdlesCleared    !== undefined) ? stats.hurdlesCleared : 0;
  const firstPassed = (stats && stats.firstHurdlePassed !== undefined) ? stats.firstHurdlePassed : (cleared > 0);

  // RULE: missing the very first hurdle = no discount at all.
  if (REWARD_CONFIG.firstHurdleRequired && !firstPassed) return 0;

  // 1% per hurdle actually cleared. A clean 20-hurdle course = the full 20%.
  let reward = cleared * REWARD_CONFIG.discountPerHurdle;

  // Accuracy gate
  const attempted = (stats && stats.hurdlesAttempted) ? stats.hurdlesAttempted : cleared;
  if (attempted > 0) {
    const acc = cleared / attempted;
    if (acc < 1) reward *= (0.55 + 0.45 * acc);
  }

  reward = Math.round(reward);
  return Math.max(REWARD_CONFIG.minimum, Math.min(REWARD_CONFIG.maximum, reward));
}

function generateCouponCode(discountPct, mobile) {
  const cleanMob = (mobile || '').toString().slice(-4) || '2026';
  const seed = (cleanMob + '_' + discountPct).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = '';
  let n = seed * 9301 + 49297;
  for (let i = 0; i < 4; i++) {
    n = (n * 9301 + 49297) % 233280;
    hash += chars[Math.floor((n / 233280) * chars.length)];
  }
  return `DERBY${discountPct}${hash}`;
}

function copyCouponCode(elementId, btnEl) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.textContent || el.innerText;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showCopied(btnEl));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopied(btnEl);
  }
}

function showCopied(btnEl) {
  if (!btnEl) return;
  const orig = btnEl.textContent;
  btnEl.textContent = '✅ COPIED!';
  btnEl.style.background = '#4CAF50';
  btnEl.style.color = '#ffffff';
  setTimeout(() => {
    btnEl.textContent = orig;
    btnEl.style.background = '';
    btnEl.style.color = '';
  }, 1800);
}

function getDifficulty(pct) {
  const d = GC.difficulty;
  for (let i = d.length - 1; i >= 0; i--) {
    if (pct >= d[i].minPct) return d[i];
  }
  return d[0];
}

/* ----------------------------- ASSET LOADING & TEXTURES ------------------- */
const SPRITES = {};
const TEXTURES = {};

// -----------------------------------------------------------------------
// SPRITE CONFIGURATION
// All horse animation frames are loaded from the sprites/ folder.
// To replace any image, simply swap the corresponding PNG file in sprites/.
// -----------------------------------------------------------------------
const SPRITE_FILES = {
  runA:  'sprites/runA.png',   // Gallop frame 1
  runB:  'sprites/runB.png',   // Gallop frame 2
  runC:  'sprites/runC.png',   // Gallop frame 3
  jumpA: 'sprites/jumpA.png',  // Jump – takeoff
  jumpB: 'sprites/jumpB.png',  // Jump – peak
  jumpC: 'sprites/jumpC.png',  // Jump – landing
  idleA: 'sprites/idleA.png',  // Idle frame 1
  idleB: 'sprites/idleB.png',  // Idle frame 2
};

function loadImage(key, src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { SPRITES[key] = img; resolve(); };
    img.onerror = () => { console.warn(`Could not load sprite: ${src}`); resolve(); };
    img.src = src;
  });
}

async function loadAllAssets() {
  const jobs = Object.entries(SPRITE_FILES).map(([key, path]) => loadImage(key, path));
  await Promise.all(jobs);

  // Create Three.js textures from loaded images
  for (const key of Object.keys(SPRITE_FILES)) {
    if (SPRITES[key]) {
      const tex = new THREE.Texture(SPRITES[key]);
      tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      TEXTURES[key] = tex;
    }
  }

  // Set start screen hero image
  if (SPRITES.jumpA) document.getElementById('startHero').src = SPRITES.jumpA.src;
}
/* =========================================================================
   ROYAL CHAMPIONSHIP DERBY — 3D ARENA ENVIRONMENT
   -------------------------------------------------------------------------
   Everything below is PURELY VISUAL. No gameplay rule, collision box,
   timer value or reward number is decided in this section.

   Depth stack (camera -> horizon):
     FOREGROUND DECOR (1.12) > TRACK / HURDLES / HORSE (1.00) >
     RAIL FENCE + BANNER WALL (0.90) > LAMP + FLAG ROW (0.30) >
     GRANDSTAND + CROWD (0.22) > DISTANT PALACE SKYLINE (0.10) > SKY (0.00)

   Parallax is applied per-layer via a single group transform (1 matrix
   update per layer per frame) instead of per-object maths.
   ========================================================================= */

const ROYAL = {
  purple:      0x2e1140,
  purpleDeep:  0x1d0a2b,
  purpleLight: 0x4a2064,
  burgundy:    0x6d1230,
  burgundyLit: 0x8c1c3c,
  gold:        0xd8b45a,
  goldBright:  0xf3dc9a,
  goldDeep:    0xa8842f,
  ivory:       0xf4ecd8,
  warmWhite:   0xfff4de,
  navy:        0x141c3a,
  brown:       0x4a2e16,
  turf:        0x2f5c2e,
  turfDark:    0x21411f,
  dirt:        0x8a5e30,
};

/* ---------- tiny canvas helpers (all textures are procedural) ---------- */
function _cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, x: c.getContext('2d') };
}
function _tex(canvas, repX = 1, repY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function _hex(n) { return '#' + n.toString(16).padStart(6, '0'); }

/* Soft radial glow — used by running lights, lanterns, dust, shadow */
function makeGlowTexture(inner = 'rgba(255,244,214,1)', mid = 'rgba(232,190,96,0.55)') {
  const { c, x } = _cv(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0.00, inner);
  g.addColorStop(0.22, mid);
  g.addColorStop(0.55, 'rgba(190,140,50,0.16)');
  g.addColorStop(1.00, 'rgba(150,110,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return _tex(c, 1, 1, false);
}

/* Soft elliptical contact shadow */
function makeShadowTexture() {
  const { c, x } = _cv(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0.0, 'rgba(20,8,26,0.85)');
  g.addColorStop(0.45, 'rgba(20,8,26,0.42)');
  g.addColorStop(1.0, 'rgba(20,8,26,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return _tex(c, 1, 1, false);
}

/* Premium raked equestrian sand/dirt with hoof marks + harrow grooves */
function createDirtTexture() {
  const S = 512;
  const { c, x } = _cv(S, S);
  const base = x.createLinearGradient(0, 0, 0, S);
  base.addColorStop(0, '#8d6234');
  base.addColorStop(0.5, '#7d5429');
  base.addColorStop(1, '#8a5f31');
  x.fillStyle = base; x.fillRect(0, 0, S, S);

  // harrow grooves running along the racing direction
  for (let i = 0; i < 190; i++) {
    const y = Math.random() * S;
    const h = 1 + Math.random() * 3.5;
    const a = 0.05 + Math.random() * 0.13;
    x.fillStyle = Math.random() > 0.5
      ? `rgba(176,132,74,${a})`
      : `rgba(74,44,16,${a})`;
    x.fillRect(0, y, S, h);
  }
  // patchy moisture variation
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * S, cy = Math.random() * S;
    const r = 30 + Math.random() * 110;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(60,36,14,${0.05 + Math.random() * 0.07})`);
    g.addColorStop(1, 'rgba(60,36,14,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  // hoof marks
  for (let i = 0; i < 120; i++) {
    const cx = Math.random() * S, cy = Math.random() * S;
    const r = 4 + Math.random() * 4;
    x.save(); x.translate(cx, cy); x.rotate(Math.random() * 0.6 - 0.3);
    x.fillStyle = 'rgba(56,32,12,0.30)';
    x.beginPath(); x.ellipse(0, 0, r, r * 0.78, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(196,156,96,0.22)';
    x.beginPath(); x.ellipse(0, -r * 0.55, r * 0.9, r * 0.35, 0, 0, 7); x.fill();
    x.restore();
  }
  // fine grain
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  return _tex(c, 26, 1);
}

/* Manicured turf */
function createTurfTexture() {
  const S = 256;
  const { c, x } = _cv(S, S);
  x.fillStyle = '#2f5c2e'; x.fillRect(0, 0, S, S);
  // mower stripes
  for (let i = 0; i < S; i += 32) {
    x.fillStyle = (i % 64 === 0) ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)';
    x.fillRect(i, 0, 32, S);
  }
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(${60 + Math.random() * 60 | 0},${110 + Math.random() * 70 | 0},${50 + Math.random() * 40 | 0},0.5)`;
    x.fillRect(Math.random() * S, Math.random() * S, 1.6, 3);
  }
  return _tex(c, 40, 8);
}

/* Royal banner board: purple/burgundy panel, gold frame, engraved text */
function createBannerTexture(text, dark = true, w = 512, h = 128) {
  const { c, x } = _cv(w, h);
  const bg = x.createLinearGradient(0, 0, 0, h);
  if (dark) { bg.addColorStop(0, '#3a1650'); bg.addColorStop(1, '#1d0a2b'); }
  else { bg.addColorStop(0, '#8c1c3c'); bg.addColorStop(1, '#4d0c20'); }
  x.fillStyle = bg; x.fillRect(0, 0, w, h);

  // gold double frame
  x.strokeStyle = _hex(ROYAL.gold); x.lineWidth = Math.max(4, h * 0.055);
  x.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
  x.strokeStyle = 'rgba(243,220,154,0.55)'; x.lineWidth = Math.max(1.5, h * 0.018);
  x.strokeRect(h * 0.13, h * 0.13, w - h * 0.26, h - h * 0.26);

  // corner fleurons
  x.fillStyle = 'rgba(216,180,90,0.85)';
  [[h * 0.2, h * 0.2], [w - h * 0.2, h * 0.2], [h * 0.2, h - h * 0.2], [w - h * 0.2, h - h * 0.2]]
    .forEach(([px, py]) => { x.beginPath(); x.arc(px, py, h * 0.045, 0, 7); x.fill(); });

  const fs = Math.min(h * 0.40, (w * 1.55) / Math.max(9, text.length));
  x.font = `bold ${fs}px Georgia, 'Times New Roman', serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillText(text, w / 2 + 2, h / 2 + 2);
  const tg = x.createLinearGradient(0, h * 0.3, 0, h * 0.75);
  tg.addColorStop(0, '#fff3cf'); tg.addColorStop(0.5, '#e8c877'); tg.addColorStop(1, '#c39a3e');
  x.fillStyle = tg; x.fillText(text, w / 2, h / 2);
  return _tex(c);
}

/* Royal crest / crown emblem on a shield */
function createCrestTexture() {
  const { c, x } = _cv(128, 128);
  x.clearRect(0, 0, 128, 128);
  // shield
  x.beginPath();
  x.moveTo(24, 20); x.lineTo(104, 20); x.lineTo(104, 70);
  x.quadraticCurveTo(104, 104, 64, 116);
  x.quadraticCurveTo(24, 104, 24, 70); x.closePath();
  const g = x.createLinearGradient(0, 20, 0, 116);
  g.addColorStop(0, '#7a1533'); g.addColorStop(1, '#3a0a1a');
  x.fillStyle = g; x.fill();
  x.strokeStyle = _hex(ROYAL.gold); x.lineWidth = 5; x.stroke();
  // crown
  x.fillStyle = '#e8c877';
  x.beginPath();
  x.moveTo(40, 62); x.lineTo(46, 40); x.lineTo(56, 55); x.lineTo(64, 34);
  x.lineTo(72, 55); x.lineTo(82, 40); x.lineTo(88, 62); x.closePath(); x.fill();
  x.fillRect(38, 63, 52, 9);
  x.fillStyle = '#fff3cf';
  [46, 64, 82].forEach(px => { x.beginPath(); x.arc(px, 38, 4, 0, 7); x.fill(); });
  return _tex(c);
}

/* Waving flag cloth */
function createFlagTexture(a, b, crest = true) {
  const { c, x } = _cv(128, 80);
  const g = x.createLinearGradient(0, 0, 128, 80);
  g.addColorStop(0, a); g.addColorStop(1, b);
  x.fillStyle = g; x.fillRect(0, 0, 128, 80);
  x.strokeStyle = 'rgba(216,180,90,0.9)'; x.lineWidth = 6;
  x.strokeRect(6, 6, 116, 68);
  if (crest) {
    x.fillStyle = 'rgba(243,220,154,0.92)';
    x.beginPath();
    x.moveTo(48, 50); x.lineTo(52, 30); x.lineTo(60, 42); x.lineTo(66, 24);
    x.lineTo(72, 42); x.lineTo(80, 30); x.lineTo(84, 50); x.closePath(); x.fill();
    x.fillRect(46, 51, 40, 7);
  }
  return _tex(c);
}

/* Checkered racing flag */
function createCheckerTexture() {
  const { c, x } = _cv(64, 64);
  for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
    x.fillStyle = (r + q) % 2 ? '#101014' : '#f6f2e6';
    x.fillRect(q * 8, r * 8, 8, 8);
  }
  return _tex(c);
}

/* Stand seating block — rows of empty seats behind the crowd */
function createSeatingTexture() {
  const { c, x } = _cv(128, 128);
  x.fillStyle = '#2a0f3c'; x.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 8; r++) {
    x.fillStyle = r % 2 ? '#3b1652' : '#331246';
    x.fillRect(0, r * 16, 128, 14);
    for (let q = 0; q < 16; q++) {
      x.fillStyle = 'rgba(0,0,0,0.28)';
      x.fillRect(q * 8 + 6, r * 16, 1.5, 14);
    }
    x.fillStyle = 'rgba(216,180,90,0.20)';
    x.fillRect(0, r * 16 + 14, 128, 1.6);
  }
  return _tex(c, 1, 1);
}

/* Distant billboard crowd row — dozens of painted spectators per panel */
function createCrowdStripTexture(variant) {
  const W = 256, H = 96;
  const { c, x } = _cv(W, H);
  x.clearRect(0, 0, W, H);
  // dark stand interior so the mass reads as depth, not floating heads
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(28,10,40,0.92)');
  bg.addColorStop(1, 'rgba(18,6,28,0.86)');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);

  const skins = ['#e8bd93', '#d19b6d', '#a86b41', '#7a4a28', '#f0cfae', '#5e3a20'];
  const cloth = ['#d8b45a', '#8c1c3c', '#3a1650', '#1b2f5e', '#f4ecd8', '#2f5c2e',
    '#b8452f', '#6b6f7a', '#e0d3b8', '#4a2e16', '#7d2f6b', '#c9a24b'];
  const rows = 4;
  for (let r = rows - 1; r >= 0; r--) {
    const y = H - 8 - r * (H / (rows + 0.9));
    const s = 0.72 + r * 0.12;          // back rows slightly smaller
    const shade = 0.55 + r * 0.11;
    const step = 13 - r * 0.6;
    for (let px = -6; px < W + 6; px += step) {
      const jx = px + (Math.random() - 0.5) * 5 + variant * 3;
      const bw = (5.5 + Math.random() * 2.4) * s;
      const bh = (13 + Math.random() * 5) * s;
      const cl = cloth[(Math.random() * cloth.length) | 0];
      x.globalAlpha = shade;
      // torso
      x.fillStyle = cl;
      x.beginPath();
      x.moveTo(jx - bw / 2, y);
      x.lineTo(jx + bw / 2, y);
      x.lineTo(jx + bw / 2.6, y - bh);
      x.lineTo(jx - bw / 2.6, y - bh);
      x.closePath(); x.fill();
      // head
      x.fillStyle = skins[(Math.random() * skins.length) | 0];
      x.beginPath(); x.arc(jx, y - bh - bw * 0.42, bw * 0.44, 0, 7); x.fill();
      // ~18% have arms up
      if (Math.random() < 0.18) {
        x.strokeStyle = cl; x.lineWidth = 1.5 * s; x.beginPath();
        x.moveTo(jx - bw / 2.4, y - bh * 0.75);
        x.lineTo(jx - bw * 0.85, y - bh * 1.35);
        x.moveTo(jx + bw / 2.4, y - bh * 0.75);
        x.lineTo(jx + bw * 0.85, y - bh * 1.35);
        x.stroke();
      }
    }
  }
  x.globalAlpha = 1;
  // warm event light falling across the crowd
  const lg = x.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, 'rgba(255,196,110,0.16)');
  lg.addColorStop(1, 'rgba(60,20,80,0.20)');
  x.fillStyle = lg; x.fillRect(0, 0, W, H);
  return _tex(c);
}

/* Painted stripe for hurdle rails */
function createRailTexture(a, b) {
  const { c, x } = _cv(128, 16);
  x.fillStyle = a; x.fillRect(0, 0, 128, 16);
  x.fillStyle = b;
  for (let i = 0; i < 128; i += 32) x.fillRect(i, 0, 16, 16);
  x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 128, 3);
  x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, 13, 128, 3);
  return _tex(c, 3, 1);
}

/* ========================= THREE.JS ENVIRONMENT =========================== */
class ThreeEnv {
  constructor() {
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;
    this.clock    = new THREE.Clock();

    this.scrollX  = 0;   // cumulative world scroll (world units)
    this.speed    = 8;

    this.camSwayAmp = 0;

    // crowd / atmosphere energy: 0 = polite applause, 1 = championship roar
    this.energy      = 0.18;
    this.energyBoost = 0;
    this.waveFront   = null;   // travelling cheer wave x position
    this.stage       = 1.0;    // environmental intensity multiplier

    this.layers = [];
    this.frameCount = 0;

    // Dust pool
    this.dustVels = [];
    this.dustLife = [];
    this.dustActive = [];
    this.DUST_COUNT = 150;

    this.init();
  }

  /* ------------------------------------------------------------------ */
  /*  Layer helper — one transform per parallax plane, seamless wrap      */
  /* ------------------------------------------------------------------ */
  makeLayer(parallax, period) {
    const g = new THREE.Group();
    this.scene.add(g);
    const L = { group: g, parallax, period };
    this.layers.push(L);
    return L;
  }
  updateLayers() {
    for (const L of this.layers) {
      L.group.position.x = -(((this.scrollX * L.parallax) % L.period) + L.period) % L.period;
    }
  }

  /* ----- Renderer & Scene ----- */
  init() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 1.5, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.scene = new THREE.Scene();
    // warm violet event haze — ties sky, stands and track together
    this.scene.fog = new THREE.FogExp2(0x53355e, 0.0092);

    const W = canvas.parentElement.clientWidth || 800;
    const H = canvas.parentElement.clientHeight || 500;
    this.camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 400);
    this.camera.position.set(-1, 4.5, 12);
    this.camera.lookAt(6, 1, 0);

    // shared assets
    this.texGlow    = makeGlowTexture();
    this.texGlowHot = makeGlowTexture('rgba(255,255,238,1)', 'rgba(255,214,130,0.7)');
    this.texShadow  = makeShadowTexture();
    this.texCrest   = createCrestTexture();
    this.texChecker = createCheckerTexture();
    this.texSeats   = createSeatingTexture();

    this.buildLighting();
    this.buildSky();
    this.buildSkyline();        // 0.10  distant royal city
    this.buildGrandstands();    // 0.22  stands + 232 live spectators + billboard mass
    this.buildFloodlights();    // 0.30  lighting towers, flag row
    this.buildGround();         // 1.00  turf + premium raked track
    this.buildTrackside();      // 0.90  banner wall, rail fence, lamps, garlands
    this.buildForeground();     // 1.12  planters, topiary, ornaments
    this.buildRunningLights();  // 1.20  champagne-gold running lights
    this.buildHurdlePool();
    this.buildFinishGate();
    this.buildHorse();
    this.buildDust();
    this.buildConfettiSystem();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const stage = document.getElementById('stage');
    const W = stage.clientWidth, H = stage.clientHeight;
    this.renderer.setSize(W, H);
    this.camera.aspect = W / H;
    // Narrow portrait: widen FOV so horse + next hurdle always stay framed
    if (this.camera.aspect < 1.1) {
      this.camera.fov = Math.min(72, 60 / Math.max(0.5, this.camera.aspect));
    } else {
      this.camera.fov = 58;
    }
    this.camera.updateProjectionMatrix();
  }

  /* ----- Cinematic evening event lighting ----- */
  buildLighting() {
    // sky bounce (violet) / ground bounce (warm sand)
    this.scene.add(new THREE.HemisphereLight(0x8f6fb0, 0x6b4a26, 0.62));

    // main warm key light — low evening sun from front-right
    const sun = new THREE.DirectionalLight(0xffd9a2, 1.55);
    sun.position.set(26, 22, 26);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -26; sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;

    // cool rim from the stands side for separation
    const rim = new THREE.DirectionalLight(0x9a7fd0, 0.42);
    rim.position.set(-24, 16, -28);
    this.scene.add(rim);
    this.rimLight = rim;

    this.scene.add(new THREE.AmbientLight(0xffe6c4, 0.26));
  }

  /* ----- Royal evening sky: gradient + drifting cloud bands + stars ----- */
  buildSky() {
    const geo = new THREE.SphereGeometry(320, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime:   { value: 0 },
        uZenith: { value: new THREE.Color(0x150a30) },
        uMid:    { value: new THREE.Color(0x5b2a63) },
        uHorizon:{ value: new THREE.Color(0xe9964a) },
        uGlow:   { value: new THREE.Color(0xffcf87) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uZenith, uMid, uHorizon, uGlow;
        varying vec3 vDir;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y*1.15 + 0.14, 0.0, 1.0);

          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.42, h));
          col = mix(col, uZenith, smoothstep(0.34, 0.95, h));

          // warm sun bloom sitting over the far end of the arena
          float sun = pow(max(0.0, dot(d, normalize(vec3(0.55, 0.10, -0.35)))), 26.0);
          col += uGlow * sun * 0.85;
          float band = exp(-abs(d.y-0.02)*7.0);
          col += uGlow * band * 0.16;

          // layered cloud bands, only in the lower sky, drifting slowly
          vec2 uv = vec2(atan(d.z, d.x)*1.7, d.y*3.4);
          float cl = fbm(uv*1.6 + vec2(uTime*0.010, 0.0));
          float cl2 = fbm(uv*3.1 + vec2(uTime*0.017, 1.7));
          float mask = smoothstep(-0.02, 0.30, d.y) * (1.0 - smoothstep(0.30, 0.78, d.y));
          float clouds = smoothstep(0.48, 0.86, cl*0.68 + cl2*0.42) * mask;
          vec3 cloudLit = mix(vec3(0.42,0.24,0.42), vec3(1.0,0.80,0.58), smoothstep(0.0,0.55,cl));
          col = mix(col, cloudLit, clouds*0.80);

          // faint stars high up
          float st = step(0.9975, hash(floor(uv*90.0)));
          col += vec3(st) * smoothstep(0.42, 0.95, h) * 0.55;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(geo, this.skyMat);
    sky.renderOrder = -100;
    this.scene.add(sky);
  }

  /* ----- Distant royal city / palace skyline (parallax 0.10) ----- */
  buildSkyline() {
    const L = this.makeLayer(0.10, 160);
    const matFar = new THREE.MeshBasicMaterial({ color: 0x3a2350, fog: true, transparent: true, opacity: 0.95 });
    const matSpire = new THREE.MeshBasicMaterial({ color: 0x4a2f63, fog: true, transparent: true, opacity: 0.95 });

    const bay = (ox) => {
      const g = new THREE.Group();
      // palace blocks
      const blocks = [
        [-58, 16, 20], [-34, 22, 26], [-12, 14, 18],
        [10, 26, 22], [34, 18, 24], [56, 21, 20], [74, 15, 18],
      ];
      for (const [bx, bh, bw] of blocks) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 6), matFar);
        m.position.set(bx, bh / 2, 0);
        g.add(m);
        // domes / spires on top
        const dome = new THREE.Mesh(new THREE.SphereGeometry(bw * 0.24, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), matSpire);
        dome.position.set(bx, bh, 0);
        g.add(dome);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 12 + (bh % 7), 6), matSpire);
        spire.position.set(bx + bw * 0.3, bh + 6, 0);
        g.add(spire);
      }
      // tall cathedral towers that break the roofline
      for (const tx of [-46, 22, 66]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(7, 40, 7), matFar);
        t.position.set(tx, 20, -2);
        g.add(t);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(5, 14, 8), matSpire);
        cap.position.set(tx, 46, -2);
        g.add(cap);
      }
      g.position.set(ox, 0, -96);
      return g;
    };
    for (let i = -2; i <= 2; i++) L.group.add(bay(i * 160));
  }

  /* ================================================================== */
  /*  MASSIVE ROYAL GRANDSTANDS + LIVE CROWD                            */
  /* ================================================================== */
  buildGrandstands() {
    const L = this.makeLayer(0.22, 24);
    this.standLayer = L;
    const BAY = 24;

    const matWall   = new THREE.MeshLambertMaterial({ color: ROYAL.purpleDeep });
    const matPanel  = new THREE.MeshLambertMaterial({ color: ROYAL.purple });
    const matBurg   = new THREE.MeshLambertMaterial({ color: ROYAL.burgundy });
    const matGold   = new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x3a2a08 });
    const matGoldB  = new THREE.MeshBasicMaterial({ color: ROYAL.goldBright });
    const matSeats  = new THREE.MeshLambertMaterial({ map: this.texSeats });
    const matCanopy = new THREE.MeshLambertMaterial({ color: ROYAL.burgundy, side: THREE.DoubleSide });
    const matCanopyU= new THREE.MeshLambertMaterial({ color: 0x3a0f22, side: THREE.DoubleSide });
    const matCrest  = new THREE.MeshBasicMaterial({ map: this.texCrest, transparent: true });

    // banner textures reused across all bays (built once)
    this.bannerTex = DERBY_CONFIG.banners.map((b, i) => createBannerTexture(b, i % 2 === 0));
    this.bannerMats = this.bannerTex.map(t => new THREE.MeshLambertMaterial({ map: t }));

    /* ---- one repeating 24-unit grandstand bay ---- */
    const buildBay = (bi, ox) => {
      const g = new THREE.Group();

      // --- lower terrace: stepped seating decks the crowd sits on ---
      for (let r = 0; r < 4; r++) {
        const z = -20.6 - r * 1.7;
        const y = 2.35 + r * 1.05;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.9, 1.7), matSeats);
        deck.position.set(0, y - 0.45, z);
        g.add(deck);
        const riser = new THREE.Mesh(new THREE.BoxGeometry(BAY, 1.05, 0.16), matWall);
        riser.position.set(0, y - 0.5, z + 0.85);
        g.add(riser);
      }

      // --- front barrier wall of the stand with gold trim + banner ---
      const wall = new THREE.Mesh(new THREE.BoxGeometry(BAY, 2.4, 0.5), matPanel);
      wall.position.set(0, 1.2, -19.6);
      g.add(wall);
      const wtrim = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.18, 0.62), matGold);
      wtrim.position.set(0, 2.42, -19.6);
      g.add(wtrim);

      const bTex = this.bannerMats[bi % this.bannerMats.length];
      const bMesh = new THREE.Mesh(new THREE.PlaneGeometry(BAY * 0.78, 1.35), bTex);
      bMesh.position.set(0, 1.3, -19.33);
      g.add(bMesh);

      // --- upper deck slab + gold balustrade ---
      const slab = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.7, 9.5), matWall);
      slab.position.set(0, 7.0, -25.4);
      g.add(slab);

      const fascia = new THREE.Mesh(new THREE.BoxGeometry(BAY, 1.5, 0.42), matBurg);
      fascia.position.set(0, 6.6, -20.7);
      g.add(fascia);
      const fasciaTrim = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.16, 0.54), matGold);
      fasciaTrim.position.set(0, 7.42, -20.7);
      g.add(fasciaTrim);
      const bMesh2 = new THREE.Mesh(new THREE.PlaneGeometry(BAY * 0.8, 1.0),
        this.bannerMats[(bi + 2) % this.bannerMats.length]);
      bMesh2.position.set(0, 6.6, -20.46);
      g.add(bMesh2);

      // gold balustrade posts (instanced: 1 draw call for the whole bay)
      this._balGeo = this._balGeo || new THREE.CylinderGeometry(0.07, 0.09, 0.85, 6);
      {
        const im = new THREE.InstancedMesh(this._balGeo, matGold, 12);
        const d = new THREE.Object3D();
        for (let i = 0; i < 12; i++) {
          d.position.set(-BAY / 2 + 1 + i * 2, 7.75, -20.9);
          d.updateMatrix(); im.setMatrixAt(i, d.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        g.add(im);
      }
      const handrail = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.11, 0.16), matGold);
      handrail.position.set(0, 8.22, -20.9);
      g.add(handrail);

      // --- upper terrace steps (billboard crowd sits here) ---
      for (let r = 0; r < 6; r++) {
        const z = -26.5 - r * 1.5;
        const y = 7.4 + r * 0.95;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.8, 1.5), matSeats);
        deck.position.set(0, y - 0.4, z);
        g.add(deck);
      }
      // back wall closing the bowl
      const back = new THREE.Mesh(new THREE.BoxGeometry(BAY, 9, 0.6), matWall);
      back.position.set(0, 12, -36);
      g.add(back);

      // --- royal columns carrying the canopy ---
      for (const cx of [-BAY / 2 + 1.2, BAY / 2 - 1.2]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 6.4, 10), matGold);
        col.position.set(cx, 11.3, -21.2);
        g.add(col);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.3), matGold);
        cap.position.set(cx, 14.6, -21.2);
        g.add(cap);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), matBurg);
        base.position.set(cx, 8.2, -21.2);
        g.add(base);
        // ornamental lantern on the column
        const lant = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), matGoldB);
        lant.position.set(cx, 15.3, -21.2);
        g.add(lant);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.texGlow, color: 0xffd98a, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85, fog: false,
        }));
        halo.scale.set(4.2, 4.2, 1);
        halo.position.set(cx, 15.3, -21.0);
        g.add(halo);
      }

      // --- canopy roof, burgundy with gold leading edge ---
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(BAY, 16), matCanopy);
      roof.rotation.x = -Math.PI / 2 + 0.16;
      roof.position.set(0, 15.6, -28.5);
      g.add(roof);
      const roofU = new THREE.Mesh(new THREE.PlaneGeometry(BAY, 16), matCanopyU);
      roofU.rotation.x = -Math.PI / 2 + 0.16;
      roofU.position.set(0, 15.5, -28.5);
      g.add(roofU);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.5, 0.7), matGold);
      edge.position.set(0, 14.4, -20.9);
      g.add(edge);
      // scalloped valance under the roof edge (instanced)
      this._valGeo = this._valGeo || new THREE.CircleGeometry(0.75, 10, 0, Math.PI);
      {
        const im = new THREE.InstancedMesh(this._valGeo, matBurg, 16);
        const d = new THREE.Object3D();
        d.rotation.z = Math.PI;
        for (let i = 0; i < 16; i++) {
          d.position.set(-BAY / 2 + 0.75 + i * 1.5, 14.15, -20.6);
          d.updateMatrix(); im.setMatrixAt(i, d.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        g.add(im);
      }

      // --- royal crest medallion every other bay ---
      if (bi % 2 === 0) {
        const crest = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), matCrest);
        crest.position.set(0, 12.0, -20.8);
        g.add(crest);
      }

      // --- roof flags ---
      for (const fx of [-7, 7]) {
        this._addFlag(g, fx, 14.6, -21.0, (bi * 2 + (fx > 0 ? 1 : 0)));
      }

      g.position.x = ox;
      return g;
    };

    for (let i = -4; i <= 4; i++) L.group.add(buildBay(((i % 4) + 4) % 4, i * BAY));

    this.buildCrowd();
  }

  /* ----- Instanced flower cluster: one draw call instead of dozens ----- */
  _flowerCluster(n, place) {
    if (!this._flowerGeo) {
      this._flowerGeo = new THREE.SphereGeometry(0.115, 6, 5);
      this._flowerMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a0206 });
      this._flowerCols = [0xd0202f, 0xe8556a, 0xf0e6d0, 0x8b3fa8, 0xc2183a];
    }
    const im = new THREE.InstancedMesh(this._flowerGeo, this._flowerMat, n);
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      place(d, i);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      c.setHex(this._flowerCols[(Math.random() * this._flowerCols.length) | 0]);
      im.setColorAt(i, c);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }

  /* ----- waving flag with vertex-deformed cloth ----- */
  _addFlag(parent, x, y, z, seed) {
    if (!this._flagPalette) {
      this._flagPalette = [
        createFlagTexture('#3a1650', '#1d0a2b'),
        createFlagTexture('#8c1c3c', '#4d0c20'),
        createFlagTexture('#d8b45a', '#a8842f', false),
        createFlagTexture('#f4ecd8', '#d8cbb0', true),
        createFlagTexture('#141c3a', '#0b1029'),
      ];
      this._flagVert = `
        uniform float uTime, uPhase, uAmp, uSpeed;
        varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 p = position;
          float w = clamp(uv.x, 0.0, 1.0);
          float s = sin(p.x*2.6 + uTime*uSpeed + uPhase);
          p.z += s * uAmp * w * w;
          p.y += sin(p.x*1.9 + uTime*uSpeed*1.27 + uPhase) * uAmp * 0.30 * w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
        }`;
      this._flagFrag = `
        uniform sampler2D uMap; uniform float uTime, uPhase, uSpeed;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(uMap, vUv);
          float sh = 0.80 + 0.20*sin(vUv.x*9.0 + uTime*uSpeed + uPhase);
          gl_FragColor = vec4(c.rgb*sh, c.a);
        }`;
    }
    this.flags = this.flags || [];
    const tex = this._flagPalette[seed % this._flagPalette.length];
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 6.2, 6),
      new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x2a1e05 }));
    pole.position.set(x, y + 3.1, z);
    parent.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color: ROYAL.goldBright }));
    knob.position.set(x, y + 6.35, z);
    parent.add(knob);

    const geo = new THREE.PlaneGeometry(3.0, 1.9, 14, 5);
    geo.translate(1.5, 0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap:   { value: tex },
        uTime:  { value: 0 },
        uPhase: { value: Math.random() * 6.28 },
        uAmp:   { value: 0.30 + Math.random() * 0.26 },
        uSpeed: { value: 2.0 + Math.random() * 1.6 },
      },
      vertexShader: this._flagVert,
      fragmentShader: this._flagFrag,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(x + 0.06, y + 5.1, z);
    parent.add(flag);
    this.flags.push(mat);
  }

  /* ================================================================== */
  /*  CROWD — 3 levels of detail, 232 live figures + billboard mass      */
  /* ================================================================== */
  buildCrowd() {
    // Crowd lives in its own group: spectators wrap individually over exactly
    // 4 grandstand bays (96u), so they always stay in the same seats.
    const parent = new THREE.Group();
    this.crowdGroup = parent;
    this.scene.add(parent);
    const RANGE = 96;          // exactly 4 grandstand bays -> seamless wrap
    const X0 = -36;
    this.crowdRange = RANGE;
    this.crowdX0 = X0;

    const SKIN = [0xe8bd93, 0xd19b6d, 0xa86b41, 0x7a4a28, 0xf0cfae, 0x5e3a20];
    const CLOTH = [0xd8b45a, 0x8c1c3c, 0x3a1650, 0x1b2f5e, 0xf4ecd8, 0x2f5c2e,
      0xb8452f, 0x6b6f7a, 0xe0d3b8, 0x4a2e16, 0x7d2f6b, 0xc9a24b, 0x9c2f2f, 0x2b6f7a];

    // ---------- geometry shared by every spectator ----------
    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.34, 0.90, 6);
    const headGeo  = new THREE.SphereGeometry(0.19, 7, 6);
    const armGeo   = new THREE.CylinderGeometry(0.085, 0.075, 0.62, 5);
    armGeo.translate(0, -0.31, 0);      // pivot at the shoulder

    const torsoMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const headMat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const armMat   = new THREE.MeshLambertMaterial({ color: 0xffffff });

    /* --- NEAR tier: 2 rows, full body with animated arms --- */
    const NEAR_ROWS = [
      { z: -20.75, y: 2.35, n: 46 },
      { z: -22.45, y: 3.40, n: 46 },
    ];
    /* --- MID tier: 2 rows, torso + head --- */
    const MID_ROWS = [
      { z: -24.15, y: 4.45, n: 70 },
      { z: -25.85, y: 5.50, n: 70 },
    ];

    const nearCount = NEAR_ROWS.reduce((a, r) => a + r.n, 0);
    const midCount  = MID_ROWS.reduce((a, r) => a + r.n, 0);
    this.crowdCount = nearCount + midCount;    // 232 live spectators

    this.crowdNear = {
      torso: new THREE.InstancedMesh(torsoGeo, torsoMat, nearCount),
      head:  new THREE.InstancedMesh(headGeo, headMat, nearCount),
      armL:  new THREE.InstancedMesh(armGeo, armMat, nearCount),
      armR:  new THREE.InstancedMesh(armGeo, armMat, nearCount),
      data:  [],
    };
    this.crowdMid = {
      torso: new THREE.InstancedMesh(torsoGeo, torsoMat, midCount),
      head:  new THREE.InstancedMesh(headGeo, headMat, midCount),
      data:  [],
    };

    const d = new THREE.Object3D();
    const col = new THREE.Color();

    const seat = (tier, idx, row, i) => {
      const spacing = RANGE / row.n;
      const x = X0 + i * spacing + (Math.random() - 0.5) * spacing * 0.45
        + (row.offset || 0);
      const scale = 0.86 + Math.random() * 0.30;          // body-size variation
      const headScale = 0.88 + Math.random() * 0.30;
      const st = Math.random();
      const state = st < 0.60 ? 0 : st < 0.80 ? 1 : st < 0.90 ? 2 : 3; // idle/turn/clap/wave
      const rec = {
        x, y: row.y, z: row.z + (Math.random() - 0.5) * 0.22,
        scale, headScale, state,
        phase: Math.random() * 6.283,
        rate: 0.75 + Math.random() * 0.9,
        lean: (Math.random() - 0.5) * 0.25,
      };
      tier.data.push(rec);

      const cloth = CLOTH[(Math.random() * CLOTH.length) | 0];
      col.setHex(cloth);
      tier.torso.setColorAt(idx, col);
      if (tier.armL) { tier.armL.setColorAt(idx, col); tier.armR.setColorAt(idx, col); }
      col.setHex(SKIN[(Math.random() * SKIN.length) | 0]);
      tier.head.setColorAt(idx, col);

      d.position.set(x, row.y + 0.45 * scale, rec.z);
      d.scale.set(scale, scale, scale);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      tier.torso.setMatrixAt(idx, d.matrix);
      d.position.y = row.y + 0.95 * scale;
      d.scale.setScalar(headScale);
      d.updateMatrix();
      tier.head.setMatrixAt(idx, d.matrix);
      if (tier.armL) {
        d.scale.set(scale, scale, scale);
        d.position.set(x - 0.28 * scale, row.y + 0.86 * scale, rec.z + 0.05);
        d.rotation.z = 0.25; d.updateMatrix();
        tier.armL.setMatrixAt(idx, d.matrix);
        d.position.x = x + 0.28 * scale;
        d.rotation.z = -0.25; d.updateMatrix();
        tier.armR.setMatrixAt(idx, d.matrix);
        d.rotation.z = 0;
      }
    };

    let k = 0;
    NEAR_ROWS.forEach((row, ri) => {
      row.offset = ri * (RANGE / row.n) * 0.5;   // stagger rows so gaps fill in
      for (let i = 0; i < row.n; i++) seat(this.crowdNear, k++, row, i);
    });
    k = 0;
    MID_ROWS.forEach((row, ri) => {
      row.offset = ri * (RANGE / row.n) * 0.5;
      for (let i = 0; i < row.n; i++) seat(this.crowdMid, k++, row, i);
    });

    [this.crowdNear.torso, this.crowdNear.head, this.crowdNear.armL, this.crowdNear.armR,
    this.crowdMid.torso, this.crowdMid.head].forEach(m => {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.frustumCulled = false;
      parent.add(m);
    });

    /* --- FAR tier: billboard crowd panels (the 'thousands' mass) --- */
    this.crowdFar = [];
    const PANEL_W = 6.2, PANEL_STEP = 6.0;
    const perRow = Math.round(RANGE / PANEL_STEP);      // 16 panels per row
    const FAR_ROWS = [
      { z: -26.9, y: 8.0 }, { z: -28.4, y: 8.95 }, { z: -29.9, y: 9.9 },
      { z: -31.4, y: 10.85 }, { z: -32.9, y: 11.8 }, { z: -34.4, y: 12.75 },
    ];
    const farGeo = new THREE.PlaneGeometry(PANEL_W, 2.35);
    for (let v = 0; v < 3; v++) {
      const mat = new THREE.MeshLambertMaterial({
        map: createCrowdStripTexture(v), transparent: true, alphaTest: 0.02, depthWrite: false,
      });
      const n = Math.ceil(FAR_ROWS.length * perRow / 3);
      const im = new THREE.InstancedMesh(farGeo, mat, n);
      im.frustumCulled = false;
      im.renderOrder = 1;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.crowdFar.push({ mesh: im, data: [], count: 0 });
      parent.add(im);
    }
    let idx = 0;
    for (const row of FAR_ROWS) {
      for (let i = 0; i < perRow; i++) {
        const bucket = this.crowdFar[idx % 3];
        const x = X0 + i * PANEL_STEP + (idx % 2) * 0.9;
        bucket.data.push({ x, y: row.y, z: row.z, phase: Math.random() * 6.283, rate: 0.6 + Math.random() * 0.8 });
        bucket.count++;
        idx++;
      }
    }
    for (const b of this.crowdFar) {
      b.mesh.count = b.count;
      b.data.forEach((p, i) => {
        d.position.set(p.x, p.y, p.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        b.mesh.setMatrixAt(i, d.matrix);
      });
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ----- Lighting towers + tall flag row (parallax 0.30) ----- */
  buildFloodlights() {
    const L = this.makeLayer(0.30, 48);
    const matSteel = new THREE.MeshLambertMaterial({ color: 0x2c2036 });
    const matGold  = new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x2e2106 });
    const matLamp  = new THREE.MeshBasicMaterial({ color: 0xfff6dd });
    this.beams = [];

    const bay = (ox) => {
      const g = new THREE.Group();

      // ornate floodlight mast
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 21, 8), matSteel);
      mast.position.set(0, 10.5, 0);
      g.add(mast);
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 5, 10), matGold);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, 3 + i * 4.6, 0);
        g.add(ring);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.9), matSteel);
      head.position.set(0, 21.6, 0.4);
      g.add(head);
      const capTrim = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.25, 1.1), matGold);
      capTrim.position.set(0, 22.9, 0.4);
      g.add(capTrim);
      this._lampGeo = this._lampGeo || new THREE.BoxGeometry(0.85, 0.85, 0.2);
      {
        const im = new THREE.InstancedMesh(this._lampGeo, matLamp, 8);
        const d = new THREE.Object3D();
        let k = 0;
        for (let r = 0; r < 2; r++) for (let q = 0; q < 4; q++) {
          d.position.set(-1.65 + q * 1.1, 21.1 + r * 1.0, 0.95);
          d.updateMatrix(); im.setMatrixAt(k++, d.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        g.add(im);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.texGlowHot, color: 0xfff0c8, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, fog: false,
      }));
      halo.scale.set(13, 9, 1);
      halo.position.set(0, 21.5, 1.4);
      g.add(halo);

      // soft volumetric beam sweeping the arena
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(5.2, 26, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffe0a8, transparent: true, opacity: 0.075,
          depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
        }));
      beam.position.set(0, 12.5, 6);
      beam.rotation.x = Math.PI / 2.7;
      g.add(beam);
      this.beams.push({ mesh: beam, phase: Math.random() * 6.283 });

      g.position.set(ox, 0, -18.5);
      return g;
    };
    for (let i = -3; i <= 3; i++) L.group.add(bay(i * 48));

    // tall ceremonial flag row in front of the stands
    for (let i = -3; i <= 3; i++) {
      for (const off of [-30, -12, 12, 30]) {
        const holder = new THREE.Group();
        holder.position.set(i * 48 + off, 0, -15.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 13, 6), matGold);
        pole.position.y = 6.5;
        holder.add(pole);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.7, 8),
          new THREE.MeshLambertMaterial({ color: ROYAL.burgundy }));
        base.position.y = 0.35;
        holder.add(base);
        this._addFlag(holder, 0, 7.4, 0, Math.abs(i * 4 + off) % 5);
        L.group.add(holder);
      }
    }
  }

  /* ----- Turf + premium raked equestrian track (parallax 1.00) ----- */
  buildGround() {
    // outfield turf
    this.turfTex = createTurfTexture();
    const turfMat = new THREE.MeshLambertMaterial({ map: this.turfTex, color: 0xcfe0c0 });
    const turf = new THREE.Mesh(new THREE.PlaneGeometry(700, 120), turfMat);
    turf.rotation.x = -Math.PI / 2;
    turf.position.set(0, -0.02, -18);
    turf.receiveShadow = true;
    this.scene.add(turf);

    const turfFront = new THREE.Mesh(new THREE.PlaneGeometry(700, 40), turfMat);
    turfFront.rotation.x = -Math.PI / 2;
    turfFront.position.set(0, -0.02, 24);
    turfFront.receiveShadow = true;
    this.scene.add(turfFront);

    // racing surface
    this.dirtTex = createDirtTexture();
    this.trackMat = new THREE.MeshLambertMaterial({ map: this.dirtTex, color: 0xbe9463 });
    const track = new THREE.Mesh(new THREE.PlaneGeometry(700, 7.6), this.trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0, 0);
    track.receiveShadow = true;
    this.scene.add(track);

    // darker groomed shoulders blending track into turf
    const shoulderMat = new THREE.MeshLambertMaterial({
      map: this.dirtTex, color: 0x8a6a45, transparent: true, opacity: 0.9,
    });
    [-4.35, 4.35].forEach(z => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(700, 1.5), shoulderMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(0, -0.005, z);
      this.scene.add(s);
    });

    // crisp white running lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf6f2e6, transparent: true, opacity: 0.55 });
    [-3.5, 3.5].forEach(z => {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(700, 0.16), lineMat);
      e.rotation.x = -Math.PI / 2;
      e.position.set(0, 0.008, z);
      this.scene.add(e);
    });
  }

  /* ----- Trackside: banner wall, royal rail fence, lamps, garlands ----- */
  buildTrackside() {
    const L = this.makeLayer(0.90, 24);
    this.tracksideLayer = L;
    const BAY = 24;

    const matWall = new THREE.MeshLambertMaterial({ color: ROYAL.purple });
    const matGold = new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x2e2106 });
    const matWhite = new THREE.MeshLambertMaterial({ color: 0xf6f2e6 });
    const railTex = createRailTexture('#f6f2e6', '#a8182f');
    const matRail = new THREE.MeshLambertMaterial({ map: railTex });
    const matBurg = new THREE.MeshLambertMaterial({ color: ROYAL.burgundy });

    const beadGeo = new THREE.SphereGeometry(0.085, 6, 5);
    const matBead = new THREE.MeshBasicMaterial({ color: ROYAL.goldBright });

    const bay = (bi, ox) => {
      const g = new THREE.Group();

      /* --- far side: royal banner wall behind the rail --- */
      const wall = new THREE.Mesh(new THREE.BoxGeometry(BAY, 1.7, 0.35), matWall);
      wall.position.set(0, 0.85, -6.6);
      g.add(wall);
      const wtrim = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.14, 0.45), matGold);
      wtrim.position.set(0, 1.72, -6.6);
      g.add(wtrim);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(BAY * 0.74, 1.1),
        this.bannerMats[(bi + 1) % this.bannerMats.length]);
      board.position.set(0, 0.92, -6.41);
      g.add(board);

      /* --- rail fences: white posts, gold ball caps, striped rails --- */
      this._fPostGeo = this._fPostGeo || new THREE.BoxGeometry(0.20, 1.30, 0.20);
      this._fCapGeo  = this._fCapGeo  || new THREE.SphereGeometry(0.19, 8, 7);
      this._fPliGeo  = this._fPliGeo  || new THREE.BoxGeometry(0.32, 0.18, 0.32);
      const fence = (z, withGarland) => {
        // 6 posts + gold ball caps + plinths = 3 draw calls, not 18
        const mk = (geo, mat, yy, shadow) => {
          const im = new THREE.InstancedMesh(geo, mat, 6);
          const d = new THREE.Object3D();
          for (let i = 0; i < 6; i++) {
            d.position.set(-BAY / 2 + 2 + i * 4, yy, z);
            d.updateMatrix(); im.setMatrixAt(i, d.matrix);
          }
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = !!shadow;
          g.add(im);
        };
        mk(this._fPostGeo, matWhite, 0.65, true);
        mk(this._fCapGeo, matGold, 1.42, false);
        mk(this._fPliGeo, matGold, 0.09, false);
        [1.02, 0.60].forEach(h => {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(BAY, 0.13, 0.11), matRail);
          rail.position.set(0, h, z);
          g.add(rail);
        });
        if (withGarland) {
          // draped fairy-light garland between the posts
          const n = 40;
          const beads = new THREE.InstancedMesh(beadGeo, matBead, n);
          const d = new THREE.Object3D();
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const px = -BAY / 2 + t * BAY;
            const sag = Math.abs(Math.sin(t * Math.PI * 6)) * 0.16;
            d.position.set(px, 1.16 - sag, z + 0.14);
            d.updateMatrix();
            beads.setMatrixAt(i, d.matrix);
          }
          beads.instanceMatrix.needsUpdate = true;
          g.add(beads);
          this.garlandMat = matBead;
        }
      };
      fence(-4.75, true);
      fence(5.60, true);   // near rail: crosses below the rider, never across him

      /* --- ornate lamp posts along the far rail --- */
      for (const lx of [-8, 8]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 4.2, 8), matGold);
        post.position.set(lx, 2.1, -5.9);
        g.add(post);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), matGold);
        arm.position.set(lx, 4.15, -5.9);
        g.add(arm);
        for (const dx of [-0.45, 0.45]) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 7),
            new THREE.MeshBasicMaterial({ color: 0xfff0c4 }));
          lamp.position.set(lx + dx, 4.02, -5.9);
          g.add(lamp);
          const s = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.texGlow, color: 0xffd28a, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8, fog: false,
          }));
          s.scale.set(3.4, 3.4, 1);
          s.position.set(lx + dx, 4.02, -5.85);
          g.add(s);
        }
      }

      /* --- championship sign boards on the near side --- */
      if (bi % 2 === 0) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.85),
          this.bannerMats[(bi + 3) % this.bannerMats.length]);
        sign.position.set(0, 0.78, 6.30);
        sign.rotation.y = Math.PI;
        g.add(sign);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.05, 0.12), matBurg);
        frame.position.set(0, 0.78, 6.37);
        g.add(frame);
      }

      g.position.x = ox;
      return g;
    };
    for (let i = -4; i <= 4; i++) L.group.add(bay(((i % 4) + 4) % 4, i * BAY));
  }

  /* ----- Foreground royal decoration (parallax 1.12) ----- */
  buildForeground() {
    const L = this.makeLayer(1.12, 12);
    const matBox   = new THREE.MeshLambertMaterial({ color: ROYAL.burgundy });
    const matBoxD  = new THREE.MeshLambertMaterial({ color: 0x4d0c20 });
    const matGold  = new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x2e2106 });
    const matSoil  = new THREE.MeshLambertMaterial({ color: 0x241206 });
    const matLeaf  = new THREE.MeshLambertMaterial({ color: 0x2c5c26 });
    const matCrest = new THREE.MeshBasicMaterial({ map: this.texCrest, transparent: true });

    const bay = (bi, ox) => {
      const g = new THREE.Group();

      /* --- royal flower planter --- */
      const pg = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.72, 1.05), matBox);
      box.position.y = 0.36;
      box.castShadow = true;
      pg.add(box);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(4.62, 0.14, 1.22), matGold);
      lip.position.y = 0.76;
      pg.add(lip);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.13, 1.14), matGold);
      foot.position.y = 0.05;
      pg.add(foot);
      const inset = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.42, 1.08), matBoxD);
      inset.position.y = 0.38;
      pg.add(inset);
      const crest = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), matCrest);
      crest.position.set(0, 0.40, 0.56);
      pg.add(crest);
      const soil = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.16, 0.85), matSoil);
      soil.position.y = 0.80;
      pg.add(soil);
      // foliage + dense flower heads — 2 draw calls per planter
      this._leafGeo = this._leafGeo || new THREE.SphereGeometry(0.20, 6, 5);
      {
        const leaves = new THREE.InstancedMesh(this._leafGeo, matLeaf, 22);
        const d = new THREE.Object3D();
        for (let i = 0; i < 22; i++) {
          d.position.set(-1.95 + (i / 21) * 3.9 + (Math.random() - 0.5) * 0.14,
            0.90 + Math.random() * 0.07, (Math.random() - 0.5) * 0.55);
          d.scale.set(1, 0.75, 1);
          d.updateMatrix(); leaves.setMatrixAt(i, d.matrix);
        }
        leaves.instanceMatrix.needsUpdate = true;
        pg.add(leaves);
      }
      pg.add(this._flowerCluster(46, (d, i) => {
        d.position.set(-1.98 + (i / 45) * 3.96 + (Math.random() - 0.5) * 0.26,
          1.00 + Math.random() * 0.18, (Math.random() - 0.5) * 0.72);
        d.scale.setScalar(0.85 + Math.random() * 0.5);
      }));
      pg.position.set(-3.0, 0, 7.45);
      g.add(pg);

      /* --- topiary in a gold urn (rounded, NOT a cone tree) --- */
      const tg = new THREE.Group();
      const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.30, 0.72, 10), matGold);
      urn.position.y = 0.36;
      urn.castShadow = true;
      tg.add(urn);
      const urnLip = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.44, 0.14, 10), matBox);
      urnLip.position.y = 0.74;
      tg.add(urnLip);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.42, 6),
        new THREE.MeshLambertMaterial({ color: 0x3a2a16 }));
      trunk.position.y = 0.95;
      tg.add(trunk);
      const ballR = [0.50, 0.36];
      let by = 1.24;
      for (const r of ballR) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), matLeaf);
        b.position.y = by;
        b.scale.y = 0.92;
        b.castShadow = true;
        tg.add(b);
        by += r * 1.45;
      }
      tg.position.set(2.6, 0, 7.75);
      g.add(tg);

      /* --- gold ornament bollards --- */
      if (bi % 2 === 0) {
        const bo = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.95, 8), matBox);
        shaft.position.y = 0.48;
        bo.add(shaft);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 9, 8), matGold);
        ball.position.y = 1.06;
        bo.add(ball);
        bo.position.set(6.2, 0, 7.45);
        g.add(bo);
      }

      g.position.x = ox;
      return g;
    };
    for (let i = -6; i <= 6; i++) L.group.add(bay(((i % 2) + 2) % 2, i * 12));
  }

  /* ================================================================== */
  /*  CHAMPAGNE-GOLD RUNNING LIGHTS (72 lights, pooled GPU points)       */
  /* ================================================================== */
  buildRunningLights() {
    const LIGHTS = 72;
    const TRAIL  = 4;                 // trail points behind each head
    this.LIGHT_COUNT = LIGHTS;
    this.LIGHT_TRAIL = TRAIL;
    this.lightRange = 132;
    this.lightX0 = -46;

    const N = LIGHTS * (TRAIL + 1);
    const pos   = new Float32Array(N * 3);
    const alpha = new Float32Array(N);
    const size  = new Float32Array(N);
    const col   = new Float32Array(N * 3);

    this.lights = [];
    const c = new THREE.Color();
    for (let i = 0; i < LIGHTS; i++) {
      // 44 along the track edges, 28 threaded through the rail garlands
      const onRail = i >= 44;
      const side = (i % 2 === 0) ? -1 : 1;
      const L = {
        x: this.lightX0 + (i / LIGHTS) * this.lightRange,
        y: onRail ? 1.14 : 0.20,
        z: side * (onRail ? 4.62 : 3.62),
        own: 5.5 + Math.random() * 4.5,          // forward drift along the rail
        phase: Math.random() * 6.283,
        twinkle: 5 + Math.random() * 5,
        warm: Math.random() < 0.35,
        base: 0.75 + Math.random() * 0.25,
      };
      this.lights.push(L);
      c.setHex(L.warm ? 0xfff6e2 : 0xf0c86a);
      for (let t = 0; t <= TRAIL; t++) {
        const k = i * (TRAIL + 1) + t;
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        size[k] = (t === 0 ? 0.62 : 0.46 - t * 0.075);
        alpha[k] = (t === 0 ? 1.0 : 0.55 - t * 0.12);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.lightPosAttr = geo.attributes.position;
    this.lightAlphaAttr = geo.attributes.aAlpha;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: this.texGlowHot }, uScale: { value: 300 } },
      vertexShader: `
        attribute float aAlpha; attribute float aSize; attribute vec3 aColor;
        varying float vA; varying vec3 vC;
        uniform float uScale;
        void main(){
          vA = aAlpha; vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vA; varying vec3 vC;
        void main(){
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vC * t.rgb, t.a * vA);
        }`,
    });
    this.lightPoints = new THREE.Points(geo, mat);
    this.lightPoints.frustumCulled = false;
    this.lightPoints.renderOrder = 8;
    this.scene.add(this.lightPoints);
  }

  /* ================================================================== */
  /*  PREMIUM CHAMPIONSHIP HURDLES (collision dimensions unchanged)      */
  /* ================================================================== */
  buildHurdlePool() {
    const railTexes = [
      createRailTexture('#f6f2e6', '#a8182f'),   // classic white / crimson
      createRailTexture('#f6f2e6', '#3a1650'),   // white / royal purple
      createRailTexture('#f2e3bd', '#a8842f'),   // champagne / gold
      createRailTexture('#f6f2e6', '#1b2f5e'),   // white / navy
      createRailTexture('#f6f2e6', '#6d1230'),   // white / burgundy
    ];
    this.hurdleStyleMats = railTexes.map((t, i) => ({
      rail: new THREE.MeshLambertMaterial({ map: t }),
      post: new THREE.MeshLambertMaterial({ color: 0xf6f2e6 }),
      trim: new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x2e2106 }),
      base: new THREE.MeshLambertMaterial({ color: [0x6d1230, 0x3a1650, 0xa8842f, 0x1b2f5e, 0x6d1230][i] }),
    }));

    const postGeo = new THREE.BoxGeometry(0.26, 1.95, 0.26);
    const capGeo  = new THREE.SphereGeometry(0.17, 9, 8);
    const railGeo = new THREE.BoxGeometry(0.20, 0.17, 6.5);
    const rail2Geo = new THREE.BoxGeometry(0.16, 0.13, 6.5);
    const wingGeo = new THREE.BoxGeometry(0.12, 0.85, 1.05);
    const baseGeo = new THREE.BoxGeometry(0.62, 0.22, 1.0);
    const boxGeo  = new THREE.BoxGeometry(0.5, 0.34, 1.5);

    this.hurdlePool = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const style = this.hurdleStyleMats[0];

      const posts = [], caps = [], wings = [], bases = [], boxes = [];
      [-3.25, 3.25].forEach(z => {
        const p = new THREE.Mesh(postGeo, style.post);
        p.position.set(0, 0.98, z);
        p.castShadow = true;
        g.add(p); posts.push(p);

        const cap = new THREE.Mesh(capGeo, style.trim);
        cap.position.set(0, 2.02, z);
        g.add(cap); caps.push(cap);

        const w = new THREE.Mesh(wingGeo, style.post);
        w.position.set(0, 0.62, z + (z > 0 ? 0.62 : -0.62));
        g.add(w); wings.push(w);

        const b = new THREE.Mesh(baseGeo, style.base);
        b.position.set(0, 0.11, z);
        b.castShadow = true;
        g.add(b); bases.push(b);

        // flower box at the foot of each standard
        const fb = new THREE.Mesh(boxGeo, style.base);
        fb.position.set(0.34, 0.17, z * 0.72);
        g.add(fb); boxes.push(fb);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 1.6), style.trim);
        trim.position.set(0.34, 0.35, z * 0.72);
        g.add(trim);
        g.add(this._flowerCluster(8, (d, i) => {
          d.position.set(0.34 + (Math.random() - 0.5) * 0.3,
            0.44 + Math.random() * 0.06, z * 0.72 + (i - 3.5) * 0.19);
          d.scale.setScalar(0.85 + Math.random() * 0.4);
        }));
      });

      // top rail = the one gameplay reads for height
      const rail = new THREE.Mesh(railGeo, style.rail);
      rail.castShadow = true;
      g.add(rail);
      const rail2 = new THREE.Mesh(rail2Geo, style.rail);
      g.add(rail2);
      const rail3 = new THREE.Mesh(rail2Geo, style.rail);
      g.add(rail3);

      g.visible = false;
      g.position.set(50, 0, 0);
      this.scene.add(g);
      this.hurdlePool.push({
        group: g, active: false, gameHurdle: null,
        rail, rail2, rail3, posts, caps, wings, bases, boxes,
      });
    }
  }

  /* ================================================================== */
  /*  ROYAL CHAMPIONSHIP FINISH GATE                                     */
  /* ================================================================== */
  buildFinishGate() {
    const G = new THREE.Group();
    this.finishGateGroup = G;

    const matGold = new THREE.MeshLambertMaterial({ color: ROYAL.gold, emissive: 0x3a2a08 });
    const matGoldB = new THREE.MeshBasicMaterial({ color: ROYAL.goldBright });
    const matBurg = new THREE.MeshLambertMaterial({ color: ROYAL.burgundy });
    const matPurple = new THREE.MeshLambertMaterial({ color: ROYAL.purple });

    /* --- two ornate towers --- */
    [-5.2, 5.2].forEach(z => {
      const t = new THREE.Group();
      const ped = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 2.0), matBurg);
      ped.position.y = 0.75; t.add(ped);
      const pedTrim = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 2.2), matGold);
      pedTrim.position.y = 1.56; t.add(pedTrim);

      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 8.2, 14), matGold);
      col.position.y = 5.7; t.add(col);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 2.6, 14), matBurg);
      drum.position.y = 5.7; t.add(drum);
      for (let i = 0; i < 5; i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.70, 0.09, 6, 14), matGold);
        band.rotation.x = Math.PI / 2;
        band.position.y = 2.4 + i * 1.7;
        t.add(band);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 1.9), matGold);
      cap.position.y = 10.0; t.add(cap);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), matGoldB);
      finial.position.y = 10.7; t.add(finial);

      // lanterns
      for (const dz of [-1.1, 1.1]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.42), matGoldB);
        l.position.set(0, 2.4, dz); t.add(l);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.texGlow, color: 0xffd28a, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, fog: false,
        }));
        s.scale.set(3.6, 3.6, 1);
        s.position.set(0.3, 2.4, dz);
        t.add(s);
      }

      // flower arrangement at the base (instanced)
      t.add(this._flowerCluster(18, (d) => {
        d.position.set(0.9 + (Math.random() - 0.5) * 0.6,
          0.35 + Math.random() * 0.55, (Math.random() - 0.5) * 2.1);
        d.scale.setScalar(1.0 + Math.random() * 0.5);
      }));

      // checkered flag on a staff
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), matGold);
      staff.position.set(0, 11.9, 0); t.add(staff);
      const chk = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.35),
        new THREE.MeshBasicMaterial({ map: this.texChecker, side: THREE.DoubleSide }));
      chk.position.set(0.05, 12.7, z > 0 ? 0.98 : -0.98);
      chk.rotation.y = Math.PI / 2;
      t.add(chk);
      this._chkFlags = this._chkFlags || [];
      this._chkFlags.push(chk);

      t.position.set(0, 0, z);
      G.add(t);
    });

    /* --- the arch itself --- */
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.42, 10, 26, Math.PI), matGold);
    arch.rotation.y = Math.PI / 2;
    arch.position.set(0, 9.6, 0);
    G.add(arch);
    const archInner = new THREE.Mesh(new THREE.TorusGeometry(4.65, 0.22, 8, 26, Math.PI), matBurg);
    archInner.rotation.y = Math.PI / 2;
    archInner.position.set(0, 9.6, 0);
    G.add(archInner);

    // header board
    const header = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.4, 10.4), matPurple);
    header.position.set(0, 11.0, 0);
    G.add(header);
    const headerTrim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 10.8), matGold);
    headerTrim.position.set(0, 12.8, 0);
    G.add(headerTrim);
    const headerTrim2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 10.8), matGold);
    headerTrim2.position.set(0, 9.3, 0);
    G.add(headerTrim2);

    // FINISH branding
    const { c, x } = _cv(1024, 320);
    const bg = x.createLinearGradient(0, 0, 0, 320);
    bg.addColorStop(0, '#4a1d63'); bg.addColorStop(1, '#28093a');
    x.fillStyle = bg; x.fillRect(0, 0, 1024, 320);
    x.strokeStyle = _hex(ROYAL.gold); x.lineWidth = 14;
    x.strokeRect(14, 14, 996, 292);
    x.strokeStyle = 'rgba(243,220,154,0.5)'; x.lineWidth = 4;
    x.strokeRect(34, 34, 956, 252);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 62px Georgia, serif';
    x.fillStyle = '#e8c877';
    x.fillText('ROYAL ' + DERBY_CONFIG.eventName, 512, 96);
    const tg = x.createLinearGradient(0, 140, 0, 270);
    tg.addColorStop(0, '#fff6dc'); tg.addColorStop(0.55, '#f0d089'); tg.addColorStop(1, '#c39a3e');
    x.font = 'bold 150px Georgia, serif';
    x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillText('FINISH', 516, 214);
    x.fillStyle = tg; x.fillText('FINISH', 512, 210);
    const finishTex = _tex(c);
    const fb = new THREE.Mesh(new THREE.PlaneGeometry(9.9, 3.1),
      new THREE.MeshBasicMaterial({ map: finishTex }));
    fb.position.set(0.30, 11.0, 0);
    fb.rotation.y = Math.PI / 2;
    G.add(fb);
    const fbBack = fb.clone();
    fbBack.position.x = -0.30;
    fbBack.rotation.y = -Math.PI / 2;
    G.add(fbBack);

    /* --- gold crown crowning the arch --- */
    const crown = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.8, 14), matGoldB);
    crown.add(band);
    const bandTrim = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.13, 6, 16), matGold);
    bandTrim.rotation.x = Math.PI / 2;
    bandTrim.position.y = 0.42;
    crown.add(bandTrim);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 8), matGoldB);
      spike.position.set(Math.cos(a) * 1.35, 1.05, Math.sin(a) * 1.35);
      crown.add(spike);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 7),
        new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
      pearl.position.set(Math.cos(a) * 1.35, 1.86, Math.sin(a) * 1.35);
      crown.add(pearl);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2), matGoldB);
    dome.position.y = 0.4;
    crown.add(dome);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), matGoldB);
    orb.position.y = 1.95;
    crown.add(orb);
    crown.position.set(0, 13.3, 0);
    G.add(crown);
    this.finishCrown = crown;

    // crest medallions
    const med = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: this.texCrest, transparent: true }));
    med.position.set(0.34, 7.6, 0);
    med.rotation.y = Math.PI / 2;
    G.add(med);

    /* --- garland of lights around the arch --- */
    const beadGeo = new THREE.SphereGeometry(0.13, 6, 5);
    const beads = new THREE.InstancedMesh(beadGeo, matGoldB, 40);
    const d = new THREE.Object3D();
    for (let i = 0; i < 40; i++) {
      const a = (i / 39) * Math.PI;
      d.position.set(0, 9.6 + Math.sin(a) * 4.85, -Math.cos(a) * 4.85);
      d.updateMatrix();
      beads.setMatrixAt(i, d.matrix);
    }
    beads.instanceMatrix.needsUpdate = true;
    G.add(beads);
    this.finishBeads = beads;

    // scaled so the arch, branding and crown are all fully framed as the
    // rider closes on it — it then fills the screen as he passes through
    G.scale.setScalar(0.85);
    G.position.set(400, 0, 0);
    G.visible = false;
    this.scene.add(G);
  }

  /* ----- Horse sprite billboard + soft dynamic shadow ----- */
  buildHorse() {
    const H = GC.player.horseHeight;
    const W = H * GC.player.horseAspect;

    const geo = new THREE.PlaneGeometry(W, H);
    const texKey = TEXTURES.idleA ? 'idleA' : Object.keys(TEXTURES)[0];
    const mat = new THREE.MeshBasicMaterial({
      map: TEXTURES[texKey] || null,
      transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, depthWrite: false,
    });
    this.horseMesh = new THREE.Mesh(geo, mat);
    this.horseMesh.position.set(GC.world.horseX, H / 2, 0.8);
    this.horseMesh.renderOrder = 10;
    this.scene.add(this.horseMesh);

    this.horseMats = {};
    for (const k of Object.keys(TEXTURES)) {
      this.horseMats[k] = new THREE.MeshBasicMaterial({
        map: TEXTURES[k], transparent: true, alphaTest: 0.05,
        side: THREE.DoubleSide, depthWrite: false,
      });
    }

    // soft, gradient-edged contact shadow
    this.horseShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 1.5),
      new THREE.MeshBasicMaterial({
        map: this.texShadow, transparent: true, opacity: 0.55,
        depthWrite: false, color: 0x2a0f30,
      }));
    this.horseShadow.rotation.x = -Math.PI / 2;
    this.horseShadow.position.set(GC.world.horseX, 0.012, 0.8);
    this.horseShadow.renderOrder = 5;
    this.scene.add(this.horseShadow);
    this._landPulse = 0;
  }

  /* ----- Warm billowy dust puff ----- */
  createDustTexture() {
    const { c, x } = _cv(64, 64);
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.00, 'rgba(255,240,205,0.95)');
    g.addColorStop(0.40, 'rgba(214,168,104,0.62)');
    g.addColorStop(0.78, 'rgba(150,104,52,0.22)');
    g.addColorStop(1.00, 'rgba(150,104,52,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return _tex(c, 1, 1, false);
  }

  buildDust() {
    const N = this.DUST_COUNT;
    const posArr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) posArr[i * 3 + 1] = -100;

    const geo = new THREE.BufferGeometry();
    this.dustPosAttr = new THREE.BufferAttribute(posArr, 3);
    geo.setAttribute('position', this.dustPosAttr);

    this.dustParticles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.7, map: this.createDustTexture(), transparent: true,
      opacity: 0.55, sizeAttenuation: true, depthWrite: false,
    }));
    this.dustParticles.renderOrder = 12;
    this.dustParticles.frustumCulled = false;
    this.scene.add(this.dustParticles);

    for (let i = 0; i < N; i++) {
      this.dustVels.push({ x: 0, y: 0, z: 0 });
      this.dustLife.push(0);
      this.dustActive.push(false);
    }
  }

  emitDust(x, y, z, count = 8, intensity = 1.0) {
    if (!this.dustActive || !this.dustPosAttr) return;
    let emitted = 0;
    for (let i = 0; i < this.DUST_COUNT && emitted < count; i++) {
      if (!this.dustActive[i]) {
        this.dustActive[i] = true;
        const pa = this.dustPosAttr.array;
        pa[i * 3]     = x + (Math.random() - 0.5) * 0.6;
        pa[i * 3 + 1] = y + (Math.random() - 0.5) * 0.2;
        pa[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
        this.dustVels[i].x = (-1.6 + (Math.random() - 0.5) * 2.5) * intensity;
        this.dustVels[i].y = (0.8 + Math.random() * 2.0) * intensity;
        this.dustVels[i].z = (Math.random() - 0.5) * 0.8;
        this.dustLife[i] = 0.5 + Math.random() * 0.4;
        emitted++;
      }
    }
    this.dustPosAttr.needsUpdate = true;
  }

  updateDust(dt) {
    const pa = this.dustPosAttr.array;
    let any = false;
    for (let i = 0; i < this.DUST_COUNT; i++) {
      if (!this.dustActive[i]) continue;
      this.dustLife[i] -= dt;
      if (this.dustLife[i] <= 0) {
        this.dustActive[i] = false;
        pa[i * 3 + 1] = -100;
        any = true;
      } else {
        pa[i * 3]     += this.dustVels[i].x * dt;
        pa[i * 3 + 1] += this.dustVels[i].y * dt;
        pa[i * 3 + 2] += this.dustVels[i].z * dt;
        this.dustVels[i].y -= 4 * dt;
        pa[i * 3 + 1] = Math.max(0.1, pa[i * 3 + 1]);
        any = true;
      }
    }
    if (any) this.dustPosAttr.needsUpdate = true;
  }

  /* ----- Confetti / celebration ----- */
  buildConfettiSystem() {
    this.CONFETTI_COUNT = 90;
    this.confettiPool = [];
    const colors = [ROYAL.gold, ROYAL.goldBright, ROYAL.burgundyLit, ROYAL.purpleLight,
      0xf6f2e6, 0xe8556a, 0xf0d089];
    const geo = new THREE.PlaneGeometry(0.24, 0.15);
    for (let i = 0; i < this.CONFETTI_COUNT; i++) {
      const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide,
      }));
      p.position.set(0, -100, 0);
      p.frustumCulled = false;
      this.scene.add(p);
      this.confettiPool.push({
        mesh: p, vel: new THREE.Vector3(), rotVel: new THREE.Vector3(), active: false, life: 0,
      });
    }
  }

  emitConfetti(n, x, y, spread = 1.5, power = 1) {
    let e = 0;
    for (const c of this.confettiPool) {
      if (c.active || e >= n) continue;
      c.active = true;
      c.life = 1.5 + Math.random() * 1.2;
      c.mesh.position.set(x + (Math.random() - 0.5) * spread * 2,
        y + Math.random() * spread, 0.6 + (Math.random() - 0.5) * 3.0);
      c.vel.set((Math.random() - 0.35) * 5 * power,
        (3.2 + Math.random() * 4.0) * power, (Math.random() - 0.5) * 3.4);
      c.rotVel.set(Math.random() * 11, Math.random() * 11, Math.random() * 11);
      e++;
    }
  }

  updateConfetti(dt) {
    for (const c of this.confettiPool) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        c.mesh.position.set(0, -100, 0);
      } else {
        c.mesh.position.addScaledVector(c.vel, dt);
        c.vel.y -= 7.0 * dt;
        c.vel.x -= c.vel.x * 0.6 * dt;
        c.mesh.rotation.x += c.rotVel.x * dt;
        c.mesh.rotation.y += c.rotVel.y * dt;
        c.mesh.rotation.z += c.rotVel.z * dt;
      }
    }
  }

  /* ================================================================== */
  /*  EVENT HOOKS — the arena reacts to what the rider does              */
  /* ================================================================== */
  excite(amount, wave = false) {
    this.energyBoost = Math.min(1.4, this.energyBoost + amount);
    if (wave) this.waveFront = this.crowdX0 - 6;   // wave sweeps down the stand
  }
  triggerJumpDust() {
    this.emitDust(GC.world.horseX - 0.6, 0.2, 0.8, 18, 1.6 * (1 + this.energy * 0.4));
    this._landPulse = 0;
  }
  triggerLandingDust() {
    this.emitDust(GC.world.horseX - 0.3, 0.2, 0.8, 28, 2.2 * (1 + this.energy * 0.4));
    this._landPulse = 1;
  }
  triggerClearEffect() {
    this.emitDust(GC.world.horseX + 1.2, 1.2, 0.8, 12, 1.4);
    this.emitConfetti(16, GC.world.horseX + 1.5, 2.4, 1.2, 0.9);
    this.excite(0.45, true);
  }
  onHardMode() { this.excite(1.0, true); this.emitConfetti(30, GC.world.horseX + 2, 3.0, 2.0, 1.1); }
  onVictory()  {
    this.excite(1.4, true);
    this.emitConfetti(90, GC.world.horseX + 2, 3.4, 3.0, 1.4);
    this._victoryTimer = 3.0;
  }

  /* ================================================================== */
  /*  CROWD ANIMATION — idle / head-turn / clap / wave + cheer waves     */
  /* ================================================================== */
  updateCrowd(dt, scrollDelta, t) {
    const RANGE = this.crowdRange, X0 = this.crowdX0;
    const E = this.energy;                       // 0..1.4
    const d = new THREE.Object3D();

    // travelling cheer wave
    if (this.waveFront !== null) {
      this.waveFront += (26 + 18 * E) * dt;
      if (this.waveFront > X0 + RANGE + 10) this.waveFront = null;
    }
    const wf = this.waveFront;

    const animate = (tier, withArms) => {
      const data = tier.data;
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        c.x -= scrollDelta;
        if (c.x < X0) c.x += RANGE;
        else if (c.x >= X0 + RANGE) c.x -= RANGE;

        const s = c.scale;
        // wave excitement for this spectator
        let w = 0;
        if (wf !== null) {
          const dx = Math.abs(c.x - wf);
          if (dx < 7) w = 1 - dx / 7;
        }
        const exc = Math.min(1.6, E + w * 1.2);

        // state behaviours
        let bob, twist = 0, armA = 0.25, armB = -0.25, lift = 0;
        const ph = t * (1.6 + c.rate) + c.phase;
        switch (c.state) {
          case 0: // idle — small settle
            bob = Math.sin(ph * 0.8) * 0.020 * (1 + exc);
            twist = Math.sin(ph * 0.35) * 0.08;
            break;
          case 1: // head turn / chatter
            bob = Math.sin(ph) * 0.030 * (1 + exc);
            twist = Math.sin(ph * 0.7) * 0.45;
            break;
          case 2: // clapping
            bob = Math.abs(Math.sin(ph * 1.6)) * 0.05 * (1 + exc);
            armA = 0.55 + Math.sin(ph * 9 * (0.6 + exc)) * 0.45;
            armB = -armA;
            break;
          default: // waving / cheering
            bob = Math.abs(Math.sin(ph * 1.3)) * 0.075 * (1 + exc);
            armA = 2.35 + Math.sin(ph * 5.5 * (0.6 + exc)) * 0.5;
            armB = -2.35 - Math.cos(ph * 5.0 * (0.6 + exc)) * 0.5;
            break;
        }
        // during a wave, almost everyone stands and throws their arms up
        if (w > 0.12) {
          lift = w * 0.42;
          armA = 2.5 + w * 0.4;
          armB = -2.5 - w * 0.4;
        }

        const y = c.y + bob + lift;

        d.position.set(c.x, y + 0.45 * s, c.z);
        d.rotation.set(0, twist, c.lean * 0.4);
        d.scale.set(s, s, s);
        d.updateMatrix();
        tier.torso.setMatrixAt(i, d.matrix);

        d.position.set(c.x, y + 0.95 * s, c.z);
        d.rotation.set(0, twist * 1.9, c.lean * 0.5);
        d.scale.setScalar(c.headScale);
        d.updateMatrix();
        tier.head.setMatrixAt(i, d.matrix);

        if (withArms) {
          d.scale.set(s, s, s);
          d.rotation.set(0, 0, armA);
          d.position.set(c.x - 0.28 * s, y + 0.86 * s, c.z + 0.06);
          d.updateMatrix();
          tier.armL.setMatrixAt(i, d.matrix);
          d.rotation.set(0, 0, armB);
          d.position.set(c.x + 0.28 * s, y + 0.86 * s, c.z + 0.06);
          d.updateMatrix();
          tier.armR.setMatrixAt(i, d.matrix);
        }
      }
      tier.torso.instanceMatrix.needsUpdate = true;
      tier.head.instanceMatrix.needsUpdate = true;
      if (withArms) {
        tier.armL.instanceMatrix.needsUpdate = true;
        tier.armR.instanceMatrix.needsUpdate = true;
      }
    };

    animate(this.crowdNear, true);
    animate(this.crowdMid, false);

    // far billboard rows: drift + subtle surge so the mass is never static
    for (const b of this.crowdFar) {
      for (let i = 0; i < b.data.length; i++) {
        const p = b.data[i];
        p.x -= scrollDelta;
        if (p.x < X0) p.x += RANGE;
        else if (p.x >= X0 + RANGE) p.x -= RANGE;
        let w = 0;
        if (wf !== null) {
          const dx = Math.abs(p.x - wf);
          if (dx < 9) w = 1 - dx / 9;
        }
        const bob = Math.sin(t * (1.4 + p.rate) + p.phase) * 0.035 * (1 + E) + w * 0.22;
        d.position.set(p.x, p.y + bob, p.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1 + w * 0.06, 1);
        d.updateMatrix();
        b.mesh.setMatrixAt(i, d.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ----- Running lights: bright head -> fading trail -> recycle ----- */
  updateRunningLights(dt, scrollDelta, t) {
    const pos = this.lightPosAttr.array;
    const alp = this.lightAlphaAttr.array;
    const TR = this.LIGHT_TRAIL;
    const X0 = this.lightX0, R = this.lightRange;
    const boost = 0.6 + this.stage * 0.55;

    for (let i = 0; i < this.LIGHT_COUNT; i++) {
      const L = this.lights[i];
      L.x -= scrollDelta * 1.20;              // parallax
      L.x += L.own * boost * dt;              // own forward run
      if (L.x < X0) L.x += R;
      else if (L.x >= X0 + R) L.x -= R;

      const spark = L.base * (0.62 + 0.38 * Math.sin(t * L.twinkle + L.phase));
      for (let s = 0; s <= TR; s++) {
        const k = (i * (TR + 1) + s) * 3;
        pos[k]     = L.x - s * 0.42;
        pos[k + 1] = L.y;
        pos[k + 2] = L.z;
        alp[i * (TR + 1) + s] = (s === 0 ? 1.0 : (0.55 - s * 0.115)) * spark * (0.8 + this.stage * 0.22);
      }
    }
    this.lightPosAttr.needsUpdate = true;
    this.lightAlphaAttr.needsUpdate = true;
  }

  /* ----- Sync hurdles from game state (collision untouched) ----- */
  syncHurdles(gameHurdles) {
    for (const slot of this.hurdlePool) slot.active = false;

    for (const gh of gameHurdles) {
      let slot = this.hurdlePool.find(s => s.gameHurdle === gh);
      if (!slot) slot = this.hurdlePool.find(s => !s.active);
      if (!slot) continue;

      slot.active = true;
      slot.gameHurdle = gh;
      slot.group.visible = true;
      slot.group.position.x = gh.x;
      slot.group.position.y = 0;

      const m = this.hurdleStyleMats[(gh.style || 0) % this.hurdleStyleMats.length];
      if (slot._style !== m) {
        slot._style = m;
        slot.rail.material = m.rail;
        slot.rail2.material = m.rail;
        slot.rail3.material = m.rail;
        slot.posts.forEach(p => p.material = m.post);
        slot.wings.forEach(w => w.material = m.post);
        slot.caps.forEach(c => c.material = m.trim);
        slot.bases.forEach(b => b.material = m.base);
        slot.boxes.forEach(b => b.material = m.base);
      }

      // top rail sits exactly at the gameplay height value
      slot.rail.position.set(0, gh.height, 0);
      slot.rail2.position.set(0, Math.max(0.22, gh.height - 0.34), 0);
      slot.rail3.position.set(0, Math.max(0.16, gh.height - 0.68), 0);
      slot.posts.forEach(p => {
        p.scale.y = Math.max(0.6, (gh.height + 0.55) / 1.95);
        p.position.y = (1.95 * p.scale.y) / 2;
      });
      slot.caps.forEach(c => c.position.y = 1.95 * slot.posts[0].scale.y + 0.07);
    }

    for (const slot of this.hurdlePool) {
      if (!slot.active) { slot.group.visible = false; slot.gameHurdle = null; }
    }
  }

  /* ----- Horse visual + soft dynamic shadow ----- */
  syncHorse(jumpY, animState, animFrame, gameState) {
    const H = GC.player.horseHeight;
    const isMobile = (this.camera && (this.camera.aspect < 1.1 || window.innerWidth < 768));
    const hScale = isMobile ? 0.82 : 1.0;
    this.horseMesh.scale.set(hScale, hScale, 1);
    this.horseMesh.position.y = (H * hScale) / 2 + jumpY;

    // shadow: big & dark on the ground, small & faint in the air,
    // with a brief contact pulse on landing
    this._landPulse = Math.max(0, (this._landPulse || 0) - 0.06);
    const airT = Math.min(1, jumpY / 2.4);
    const sc = (1.0 - airT * 0.45) * (1 + this._landPulse * 0.22) * hScale;
    this.horseShadow.scale.set(sc, sc, 1);
    this.horseShadow.material.opacity = (0.58 - airT * 0.36) * (1 + this._landPulse * 0.3);

    let texKey = 'idleA';
    if (gameState === STATE.GAME_OVER) {
      texKey = 'jumpC';
    } else if (animState === ANIM.JUMP) {
      const vy = this._lastVY || 0;
      if (vy > 2) texKey = 'jumpA';
      else if (vy < -2) texKey = 'jumpC';
      else texKey = 'jumpB';
    } else if (animState === ANIM.RUN) {
      texKey = ['runA', 'runB', 'runC'][animFrame % 3];
    } else {
      texKey = ['idleA', 'idleB'][animFrame % 2];
    }
    const mat = this.horseMats[texKey];
    if (mat && this.horseMesh.material !== mat) this.horseMesh.material = mat;
  }

  /* ----- World scroll: one transform per parallax layer ----- */
  scrollWorld(delta, speed) {
    this.scrollX += delta;
    this.updateLayers();
    // groomed surface + turf slide under the horse (parallax 1.0)
    if (this.dirtTex) this.dirtTex.offset.x = this.scrollX / 26.9;
    if (this.turfTex) this.turfTex.offset.x = this.scrollX / 17.5;
  }

  setCameraMode(mode) {
    if (this.cameraMode === undefined) this.cameraMode = 0;
    if (mode === undefined || mode === null) {
      this.cameraMode = (this.cameraMode + 1) % 4;
    } else {
      this.cameraMode = Math.abs(mode) % 4;
    }
    const names = ['CAM: SIDE', 'CAM: CLOSE', 'CAM: HIGH', 'CAM: CINEMATIC'];
    const lbl = document.getElementById('cameraModeLbl');
    if (lbl) lbl.textContent = names[this.cameraMode];
    const pauseLbl = document.getElementById('pauseCamLbl');
    if (pauseLbl) pauseLbl.textContent = names[this.cameraMode];
    return this.cameraMode;
  }

  /* ----- Camera with multiple player-selectable views ----- */
  updateCamera(dt, jumpY, speed, hardMode) {
    if (this.cameraMode === undefined) this.cameraMode = 0;
    const aspect = this.camera.aspect || 1.0;
    const isMobilePortrait = (aspect < 1.1 || window.innerWidth < 768);

    let targetZ, targetCamX, targetY, lookX, lookY;
    const jumpFollow = jumpY * 0.25;

    const swayTarget = Math.min(0.12, speed * 0.005);
    this.camSwayAmp += (swayTarget - this.camSwayAmp) * dt * 3;

    const t = performance.now() * 0.001;
    const sway = Math.sin(t * 2.8) * this.camSwayAmp;
    const bounce = Math.sin(t * 5.6) * this.camSwayAmp * 0.3;

    switch (this.cameraMode) {
      case 1: // CLOSE-UP / ACTION
        targetZ = (isMobilePortrait ? 11.8 : 8.2) + (hardMode ? 0 : 0.3);
        targetCamX = isMobilePortrait ? -2.4 : -0.2;
        targetY = (isMobilePortrait ? 3.8 : 3.2) + jumpFollow * 0.8 + bounce;
        lookX = (isMobilePortrait ? 3.0 : 4.2) + sway;
        lookY = 1.2 + jumpY * 0.15;
        break;
      case 2: // BROADCAST / HIGH OVERVIEW
        targetZ = (isMobilePortrait ? 18.5 : 15.0);
        targetCamX = isMobilePortrait ? -3.8 : -1.5;
        targetY = (isMobilePortrait ? 8.8 : 8.5) + jumpFollow * 0.5;
        lookX = (isMobilePortrait ? 3.5 : 5.5) + sway;
        lookY = 0.5;
        break;
      case 3: // CINEMATIC DYNAMIC ANGLED
        targetZ = (isMobilePortrait ? 13.8 : 9.8);
        targetCamX = isMobilePortrait ? -4.5 : -3.2;
        targetY = (isMobilePortrait ? 3.0 : 2.5) + jumpFollow * 0.7 + bounce * 0.5;
        lookX = (isMobilePortrait ? 3.8 : 4.8) + sway;
        lookY = 1.4 + jumpY * 0.2;
        break;
      case 0: // SIDE (Default Classic)
      default:
        targetZ = (isMobilePortrait ? 16.5 : 12.0) + (hardMode ? 0 : 0.5);
        targetCamX = isMobilePortrait ? -3.8 : -1.0;
        targetY = (isMobilePortrait ? 4.8 : 4.5) + jumpFollow + bounce;
        lookX = (isMobilePortrait ? 3.2 : 5.0) + sway;
        lookY = 1.0 + jumpY * 0.12;
        break;
    }

    const lerpSpeed = Math.min(1.0, dt * 5.0);
    this.camera.position.x += (targetCamX - this.camera.position.x) * lerpSpeed;
    this.camera.position.y += (targetY - this.camera.position.y) * lerpSpeed;
    this.camera.position.z += (targetZ - this.camera.position.z) * lerpSpeed;

    this.camera.lookAt(lookX, lookY, 0);
  }

  /* ----- Shared atmosphere update (used while playing AND on start screen) */
  updateAtmosphere(dt, scrollDelta, pct) {
    const t = performance.now() * 0.001;
    this.frameCount++;

    // stage intensity: 0-30 / 30-50 / 50-75 / 75-90 / 90-100
    const target = (pct < 30) ? 1.0 : (pct < 50) ? 1.25 : (pct < 75) ? 1.55 : (pct < 90) ? 1.9 : 2.3;
    this.stage += (target - this.stage) * Math.min(1, dt * 1.5);

    // crowd energy: baseline rises with progress, boosts decay
    this.energyBoost = Math.max(0, this.energyBoost - dt * 0.55);
    const baseline = 0.16 + (this.stage - 1.0) * 0.34;
    this.energy = Math.min(1.4, baseline + this.energyBoost);

    this.updateCrowd(dt, scrollDelta * 0.22, t);
    this.updateRunningLights(dt, scrollDelta, t);

    if (this.skyMat) this.skyMat.uniforms.uTime.value = t;
    if (this.flags) for (const f of this.flags) f.uniforms.uTime.value = t;
    if (this._chkFlags) {
      for (let i = 0; i < this._chkFlags.length; i++) {
        this._chkFlags[i].rotation.z = Math.sin(t * 3.2 + i) * 0.16;
      }
    }
    if (this.beams) {
      for (const b of this.beams) {
        b.mesh.rotation.z = Math.sin(t * 0.55 * this.stage + b.phase) * 0.30;
        b.mesh.rotation.x = Math.PI / 2.7 + Math.cos(t * 0.4 + b.phase) * 0.06;
        b.mesh.material.opacity = 0.055 + 0.035 * this.stage
          + Math.sin(t * 2.2 + b.phase) * 0.012;
      }
    }
    // garlands share one material, so a single colour tween shimmers them all
    if (this.garlandMat) {
      const sh = 0.80 + 0.20 * Math.sin(t * 2.4);
      this.garlandMat.color.setRGB(sh, 0.92 * sh, 0.66 * sh);
    }
    if (this.finishCrown) this.finishCrown.rotation.y = t * 0.35;
    if (this.sun) this.sun.intensity = 1.42 + this.stage * 0.10;
    if (this.rimLight) this.rimLight.intensity = 0.36 + this.stage * 0.09;
    this.renderer.toneMappingExposure = 1.12 + this.stage * 0.045;

    this.updateDust(dt);
    this.updateConfetti(dt);
  }

  /* ----- Idle / start-screen render ----- */
  renderIdle(dt) {
    const delta = 6 * dt;
    this.scrollWorld(delta, 6);
    this.updateAtmosphere(dt, delta, 0);
    this.updateCamera(dt, 0, 6, false);
    this.renderer.render(this.scene, this.camera);
  }

  /* ----- Main render ----- */
  render(dt, game) {
    if (!game) { this.renderer.render(this.scene, this.camera); return; }

    const isGameOver = (game.state === STATE.GAME_OVER);
    const isPaused   = (game.state === STATE.PAUSED);
    const speed = (isGameOver || isPaused) ? 0 : getDifficulty(game.progress).speed;
    this.speed = speed;

    const delta = (isGameOver || isPaused) ? 0 : speed * dt;
    if (!isGameOver && !isPaused) this.scrollWorld(delta, speed);

    this.syncHorse(game.jumpY, game.animState, game.animFrame, game.state);
    this._lastVY = game.jumpVY;
    this.syncHurdles(game.hurdles);

    // continuous hoof dust while galloping (reduced slightly on mobile view)
    const isMobile = (this.camera.aspect < 1.1 || window.innerWidth < 768);
    const dustProb = isMobile ? 0.18 : 0.35;
    const dustCount = isMobile ? 2 : 3;
    if (game.state === STATE.PLAYING && !game.isAirborne && Math.random() < dustProb) {
      this.emitDust(GC.world.horseX - 0.8, 0.2, 0.8, dustCount, (isMobile ? 0.6 : 0.8) + this.stage * 0.1);
    }

    if (!isPaused) this.updateAtmosphere(dt, delta, game.progress);
    this.updateCamera(dt, game.jumpY, speed, game.hardMode);

    /* --- finish gate: driven by real remaining course distance --- */
    if (this.finishGateGroup) {
      const fx = (game.finishDistance !== undefined && game.finishDistance !== null)
        ? game.finishDistance : 400;
      this.finishGateGroup.position.x = fx;
      this.finishGateGroup.visible = fx < 200;
    }

    // sustained celebration after victory
    if (this._victoryTimer > 0) {
      this._victoryTimer -= dt;
      if (Math.random() < 0.5) this.emitConfetti(6, GC.world.horseX + 1, 4.0, 3.5, 1.2);
      if (Math.random() < 0.15) this.excite(0.5, true);
    }

    this.renderer.render(this.scene, this.camera);
  }

  renderStatic() {
    this.updateCamera(0.016, 0, 8, false);
    this.renderer.render(this.scene, this.camera);
  }
}


/* ----------------------------- GOOGLE SHEETS INTEGRATION ------------------- */
// Deployed Google Apps Script Web App URL:
const GOOGLE_SHEET_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwnrDd7j1JgVfCvWnNQj_cHt4-ueHKUEEWIBfN4QbhvWNWoi5SS5ICfFvnAvJo_nbxdSw/exec';

async function callGoogleSheetAPI(params) {
  if (!GOOGLE_SHEET_SCRIPT_URL || !GOOGLE_SHEET_SCRIPT_URL.trim()) {
    return null;
  }
  try {
    const url = new URL(GOOGLE_SHEET_SCRIPT_URL);
    Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
    const resp = await fetch(url.toString(), { credentials: 'omit' });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json;
  } catch (err) {
    console.error('Google Sheet API error:', err);
    return null;
  }
}

async function checkExistingPlayer(mobile) {
  const cleanMobile = (mobile || '').trim();
  if (!cleanMobile) return null;

  if (GOOGLE_SHEET_SCRIPT_URL && GOOGLE_SHEET_SCRIPT_URL.trim()) {
    const res = await callGoogleSheetAPI({ action: 'check', mobile: cleanMobile });
    if (res && res.status === 'success') {
      if (res.exists && res.player) {
        try {
          localStorage.setItem('derby_player_' + cleanMobile, JSON.stringify(res.player));
        } catch(e){}
        return res.player;
      } else {
        // Record deleted or not found in Google Sheet -> Purge stale local cache!
        try {
          localStorage.removeItem('derby_player_' + cleanMobile);
        } catch(e){}
        return null;
      }
    }
  }

  // Fallback to local storage if URL not configured or offline
  try {
    const raw = localStorage.getItem('derby_player_' + cleanMobile);
    if (raw) return JSON.parse(raw);
  } catch(e){}

  return null;
}

async function savePlayerRecord(name, mobile) {
  const cleanMobile = (mobile || '').trim();
  const cleanName = (name || '').trim();
  const initialCoupon = generateCouponCode(0, cleanMobile);
  const record = {
    name: cleanName,
    mobile: cleanMobile,
    attempts_used: 0,
    best_reward: '0% OFF',
    coupon_code: initialCoupon,
    completed: false,
    created_at: new Date().toISOString()
  };

  try {
    localStorage.setItem('derby_player_' + cleanMobile, JSON.stringify(record));
  } catch(e){}

  if (GOOGLE_SHEET_SCRIPT_URL && GOOGLE_SHEET_SCRIPT_URL.trim()) {
    await callGoogleSheetAPI({
      action: 'save',
      name: cleanName,
      mobile: cleanMobile,
      attempts_used: 0,
      best_reward: '0% OFF',
      coupon_code: initialCoupon,
      completed: false,
      progress: 0,
      accuracy: 0
    });
  }

  return record;
}

async function updatePlayerResult(mobile, stats, isClaimed = false) {
  const cleanMobile = (mobile || '').trim();
  if (!cleanMobile) return null;

  const currentRewardNum = stats.reward || 0;
  let existing = await checkExistingPlayer(cleanMobile);

  let attemptsUsed = existing ? (parseInt(existing.attempts_used) || 0) : 0;
  let bestRewardNum = 0;
  if (existing && existing.best_reward) {
    const parsed = parseInt(existing.best_reward);
    if (!isNaN(parsed)) bestRewardNum = parsed;
  }

  const newBestNum = Math.max(bestRewardNum, currentRewardNum);
  const newAttempts = Math.min(3, attemptsUsed + 1);
  const completed = isClaimed || newBestNum >= 20 || newAttempts >= 3;
  const bestRewardStr = newBestNum + '% OFF';
  const couponCode = generateCouponCode(newBestNum, cleanMobile);

  const localObj = {
    name: (existing && existing.name) ? existing.name : '',
    mobile: cleanMobile,
    attempts_used: newAttempts,
    best_reward: bestRewardStr,
    coupon_code: couponCode,
    completed: completed
  };

  try {
    localStorage.setItem('derby_player_' + cleanMobile, JSON.stringify(localObj));
  } catch(e){}

  if (GOOGLE_SHEET_SCRIPT_URL && GOOGLE_SHEET_SCRIPT_URL.trim()) {
    await callGoogleSheetAPI({
      action: 'update',
      name: localObj.name,
      mobile: cleanMobile,
      attempts_used: newAttempts,
      best_reward: bestRewardStr,
      coupon_code: couponCode,
      completed: completed,
      progress: stats.progress || 0,
      accuracy: Math.round((stats.accuracy || 0) * 100)
    });
  }

  return localObj;
}

/* ========================= GAME CLASS ===================================== */
class Game {
  constructor(env) {
    this.env = env;
    this.player = null;
    this.state = STATE.START;
    this.animState = ANIM.IDLE;

    this.progress = 0;
    this.hardMode = false;
    this.hurdlesCleared = 0;
    this.hurdlesAttempted = 0;
    this.firstHurdlePassed = false;

    // Timer state
    this.elapsedTime   = 0;
    this.remainingTime = TIMER_CONFIG.initialSeconds;

    // Result object
    this.lastResultData = null;

    // Physics (world units)
    this.jumpY  = 0;
    this.jumpVY = 0;
    this.isAirborne = false;

    // Hurdles
    this.hurdles = [];
    this.spawnTimer = 0;
    this.timePlayed = 0;

    // Animation
    this.animTimer  = 0;
    this.animFrame  = 0;
    this.idleTimer  = 0;
    this.idleFrame  = 0;

    this.lastTime = performance.now();
    this._bindInput();
  }

  _bindInput() {
    const jump = (e) => { if (e) e.preventDefault(); this.requestJump(); };
    window.addEventListener('keydown', e => {
      const active = document.activeElement;
      const activeTag = active ? active.tagName.toUpperCase() : '';
      const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' ||
          targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' ||
          (active && active.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp') jump(e);
      if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        if (this.env && (this.state === STATE.PLAYING || this.state === STATE.PAUSED)) {
          this.env.setCameraMode();
        }
      }
      if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P' || e.code === 'Escape') {
        if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
          this.togglePause();
        }
      }
    });
    const btn = document.getElementById('jumpBtn');
    const press   = e => { btn.classList.add('pressed'); jump(e); };
    const release = () => btn.classList.remove('pressed');
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release);
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);

    document.getElementById('muteBtn').addEventListener('click', () => {
      const m = !Sound.isMuted();
      Sound.setMuted(m);
      document.getElementById('muteBtn').textContent = m ? '🔇' : '🔊';
    });

    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
          this.togglePause();
        }
      });
    }

    const camBtn = document.getElementById('cameraBtn');
    if (camBtn) {
      camBtn.addEventListener('click', () => {
        if (this.env && (this.state === STATE.PLAYING || this.state === STATE.PAUSED)) {
          this.env.setCameraMode();
        }
      });
    }

    const pauseCamBtn = document.getElementById('pauseCamBtn');
    if (pauseCamBtn) {
      pauseCamBtn.addEventListener('click', () => {
        if (this.env && (this.state === STATE.PLAYING || this.state === STATE.PAUSED)) {
          this.env.setCameraMode();
        }
      });
    }

    const btnResume = document.getElementById('btnResume');
    if (btnResume) {
      btnResume.addEventListener('click', () => {
        if (this.state === STATE.PAUSED) this.togglePause();
      });
    }
  }

  requestJump() {
    if (this.state !== STATE.PLAYING || this.isAirborne) return;
    this.isAirborne = true;
    this.jumpVY = GC.player.jumpVelocity;
    this.animState = ANIM.JUMP;
    this.animFrame = 0;
    this.animTimer = 0;
    this.env.triggerJumpDust();
    Sound.jump();
  }

  getDiff() { return getDifficulty(this.progress); }

  reset() {
    this.progress = 0;
    this.distanceTraveled = 0;
    // Finish-gate distance is DERIVED from the real remaining course, never a
    // hard-coded X. It re-anchors every frame, so it stays correct if speed,
    // hurdle spacing or the difficulty curve changes.
    this.hurdlesToWin = GC.progression.hurdlesToWin;
    const d0 = GC.difficulty[0];
    this.finishDistance = this.hurdlesToWin * d0.speed * ((d0.gapMs[0] + d0.gapMs[1]) / 2000)
                          + GC.world.spawnX;
    this.hardMode = false;
    this.hurdlesCleared = 0;
    this.hurdlesAttempted = 0;
    this.firstHurdlePassed = false;

    this.elapsedTime = 0;
    this.remainingTime = TIMER_CONFIG.initialSeconds;

    this.hurdles = [];
    this.spawnTimer = 500; // ultra fast initial delay ~0.5s so first hurdle arrives instantly!
    this.timePlayed = 0;
    this.jumpY  = 0;
    this.jumpVY = 0;
    this.isAirborne = false;
    this.animState = ANIM.RUN;
    this.animFrame = 0;
    this.animTimer = 0;
    this.idleFrame = 0;
    this.idleTimer = 0;

    // Reset HUD elements
    const modePill = document.getElementById('modePill');
    if (modePill) modePill.innerHTML = 'MODE: <b>EASY</b>';
    const progPill = document.getElementById('progressPill');
    if (progPill) progPill.innerHTML = 'PROGRESS: <b>0%</b>';
    const rewPill = document.getElementById('rewardPill');
    if (rewPill) rewPill.innerHTML = 'REWARD: <b>0% OFF</b>';
    const progFill = document.getElementById('progressFill');
    if (progFill) progFill.style.width = '0%';
  }

  start() {
    this.reset();
    this.state = STATE.PLAYING;
    this.lastTime = performance.now();
    Sound.startMusic();
    showScreen(null);
  }

  getStats() {
    const accuracy = this.hurdlesAttempted > 0 ? (this.hurdlesCleared / this.hurdlesAttempted) : (this.firstHurdlePassed ? 1 : 0);
    return {
      progress: Math.floor(this.progress),
      elapsedTime: this.elapsedTime.toFixed(2),
      remainingTime: this.remainingTime.toFixed(2),
      hurdlesAttempted: this.hurdlesAttempted,
      hurdlesCleared: this.hurdlesCleared,
      accuracy: accuracy,
      firstHurdlePassed: this.firstHurdlePassed,
      hardModeReached: this.hardMode,
      completed: this.state === STATE.VICTORY,
      timedOut: this.state === STATE.TIMEOUT,
    };
  }

  async _handleRunFinished(stats, isClaimed = false) {
    if (this.player && this.player.mobile) {
      const resData = await updatePlayerResult(this.player.mobile, stats, isClaimed);
      if (resData) {
        if (this.player.attempts_used !== undefined) {
          this.player.attempts_used = resData.attempts_used;
        }
        if (this.player.best_reward !== undefined) {
          this.player.best_reward = resData.best_reward;
        }
      }
    }
  }

  gameOver() {
    if (this.state === STATE.GAME_OVER) return;
    this.state = STATE.GAME_OVER;
    this.animState = ANIM.HIT;
    Sound.hit();
    Sound.stopGallop();
    Sound.stopMusic();

    const stats = this.getStats();
    const reward = calculateReward(this.progress, this.elapsedTime, this.remainingTime, stats);
    stats.reward = reward;
    this.lastResultData = stats;

    const mob = (this.player && this.player.mobile) ? this.player.mobile : '';
    let existingRaw = null;
    try {
      const raw = localStorage.getItem('derby_player_' + mob);
      if (raw) existingRaw = JSON.parse(raw);
    } catch(e){}

    const attemptsUsed = existingRaw ? (parseInt(existingRaw.attempts_used) || 0) : 0;
    const bestRewardNum = existingRaw ? (parseInt(existingRaw.best_reward) || 0) : 0;
    const newBestNum = Math.max(bestRewardNum, reward);
    const newAttempts = Math.min(3, attemptsUsed + 1);

    const tempResData = {
      attempts_used: newAttempts,
      best_reward: newBestNum + '% OFF',
      completed: newBestNum >= 20 || newAttempts >= 3
    };

    document.getElementById('overProgress').textContent = stats.progress + '%';
    document.getElementById('overAccuracy').textContent = Math.round(stats.accuracy * 100) + '%';
    document.getElementById('overReward').textContent = reward + '% OFF';

    if (!stats.firstHurdlePassed) {
      document.getElementById('overTitle').textContent = 'Failed 1st Hurdle';
      document.getElementById('overDesc').textContent = 'You must clear at least the 1st hurdle to earn a discount.';
    } else {
      document.getElementById('overTitle').textContent = 'Hurdle Missed';
      document.getElementById('overDesc').textContent = 'The horse caught the rail. Here is your earned discount.';
    }

    // INSTANT POPUP DISPLAY — 0ms delay!
    this.renderResultCardUI('over', reward, tempResData);
    showScreen('screenOver');

    // Non-blocking background sync to Google Sheets
    if (mob) {
      updatePlayerResult(mob, stats, false).then(resData => {
        if (resData) this.renderResultCardUI('over', reward, resData);
      });
    }
  }

  timeOut() {
    if (this.state === STATE.TIMEOUT) return;
    this.state = STATE.TIMEOUT;
    Sound.stopGallop();
    Sound.stopMusic();

    const stats = this.getStats();
    const reward = calculateReward(this.progress, this.elapsedTime, 0, stats);
    stats.reward = reward;
    this.lastResultData = stats;

    const mob = (this.player && this.player.mobile) ? this.player.mobile : '';
    let existingRaw = null;
    try {
      const raw = localStorage.getItem('derby_player_' + mob);
      if (raw) existingRaw = JSON.parse(raw);
    } catch(e){}

    const attemptsUsed = existingRaw ? (parseInt(existingRaw.attempts_used) || 0) : 0;
    const bestRewardNum = existingRaw ? (parseInt(existingRaw.best_reward) || 0) : 0;
    const newBestNum = Math.max(bestRewardNum, reward);
    const newAttempts = Math.min(3, attemptsUsed + 1);

    const tempResData = {
      attempts_used: newAttempts,
      best_reward: newBestNum + '% OFF',
      completed: newBestNum >= 20 || newAttempts >= 3
    };

    document.getElementById('timeProgress').textContent = stats.progress + '%';
    document.getElementById('timeAccuracy').textContent = Math.round(stats.accuracy * 100) + '%';
    document.getElementById('timeReward').textContent = reward + '% OFF';

    // INSTANT POPUP DISPLAY — 0ms delay!
    this.renderResultCardUI('time', reward, tempResData);
    showScreen('screenTimeout');

    // Non-blocking background sync to Google Sheets
    if (mob) {
      updatePlayerResult(mob, stats, false).then(resData => {
        if (resData) this.renderResultCardUI('time', reward, resData);
      });
    }
  }

  victory() {
    if (this.state === STATE.VICTORY) return;
    this.state = STATE.VICTORY;
    if (this.env.onVictory) this.env.onVictory();
    Sound.victory();
    Sound.stopGallop();
    Sound.stopMusic();

    const stats = this.getStats();
    const reward = 20;
    stats.reward = reward;
    this.lastResultData = stats;

    const mob = (this.player && this.player.mobile) ? this.player.mobile : '';
    const code = generateCouponCode(20, mob);
    const vicCodeEl = document.getElementById('victoryCouponVal');
    if (vicCodeEl) vicCodeEl.textContent = code;

    document.getElementById('victoryTime').textContent = stats.elapsedTime + 's';
    document.getElementById('victoryAccuracy').textContent = Math.round(stats.accuracy * 100) + '%';
    document.getElementById('victoryReward').textContent = '20% OFF';

    // INSTANT POPUP DISPLAY — 0ms delay!
    showScreen('screenVictory');

    // Non-blocking background sync to Google Sheets
    if (mob) {
      updatePlayerResult(mob, stats, true);
    }
  }

  renderResultCardUI(prefix, currentReward, resData) {
    const attempts = resData ? resData.attempts_used : 1;
    const bestRewardStr = resData ? resData.best_reward : (currentReward + '% OFF');
    const bestNum = parseInt(bestRewardStr) || currentReward;
    const isCompleted = resData ? resData.completed : false;

    const mob = (this.player && this.player.mobile) ? this.player.mobile : '';
    const code = generateCouponCode(bestNum, mob);
    const codeEl = document.getElementById(prefix + 'CouponVal');
    if (codeEl) codeEl.textContent = code;

    const infoEl = document.getElementById(prefix + 'AttemptInfo');
    const actionsEl = document.getElementById(prefix + 'ActionsWrap');
    const noticeEl = document.getElementById(prefix + 'Notice');
    const badgeEl = document.getElementById(prefix + 'Badge');

    if (noticeEl) noticeEl.style.display = 'block';

    if (currentReward >= 20 || isCompleted || attempts >= 3) {
      if (infoEl) infoEl.textContent = `All 3 Attempts Completed • Best Discount: ${bestRewardStr}`;
      if (actionsEl) actionsEl.style.display = 'none';
      if (badgeEl) {
        badgeEl.style.display = 'inline-block';
        badgeEl.textContent = (currentReward >= 20) ? '🏆 20% MAX REWARD UNLOCKED' : '✅ ALL ATTEMPTS COMPLETED';
      }
    } else {
      const remaining = 3 - attempts;
      if (infoEl) {
        infoEl.textContent = `Attempt ${attempts} of 3 Completed • ${remaining} ${remaining === 1 ? 'Attempt' : 'Attempts'} Remaining (Best: ${bestRewardStr})`;
      }
      if (actionsEl) actionsEl.style.display = 'flex';
      if (badgeEl) badgeEl.style.display = 'none';
    }
  }

  claimDiscount(prefix) {
    const stats = this.lastResultData || this.getStats();
    const mob = (this.player && this.player.mobile) ? this.player.mobile : '';
    const bestNum = stats.reward || 0;
    const code = generateCouponCode(bestNum, mob);
    const codeEl = document.getElementById(prefix + 'CouponVal');
    if (codeEl) codeEl.textContent = code;

    const actionsEl = document.getElementById(prefix + 'ActionsWrap');
    const noticeEl = document.getElementById(prefix + 'Notice');
    const badgeEl = document.getElementById(prefix + 'Badge');
    if (actionsEl) actionsEl.style.display = 'none';
    if (noticeEl) noticeEl.style.display = 'block';
    if (badgeEl) {
      badgeEl.style.display = 'inline-block';
      badgeEl.textContent = '✅ DISCOUNT CLAIMED & LOCKED';
    }

    // Non-blocking background sync to Google Sheets
    if (mob) {
      updatePlayerResult(mob, stats, true);
    }
  }

  setProgress(val) {
    const prevDiff = this.getDiff();
    this.progress = Math.min(100, Math.max(0, val));
    const currentDiff = this.getDiff();

    if (currentDiff && currentDiff.name !== (prevDiff ? prevDiff.name : '')) {
      const modePill = document.getElementById('modePill');
      if (modePill) modePill.innerHTML = `MODE: <b>${currentDiff.name.replace(/^[^\s]+\s+/, '')}</b>`;
      flashHardModeBanner(currentDiff.name, currentDiff.color);
    }

    if (this.progress >= GC.progression.completion) {
      this.victory();
    }
  }

  spawnHurdle() {
    const diff = this.getDiff();
    
    // Mismatched hurdle height pattern: alternate small/low, medium, and tall hurdles
    const typePattern = [0, 2, 0, 1, 2, 1, 0, 2]; // 0=small/low, 1=medium, 2=tall
    const hurdleIndex = this.hurdlesAttempted + this.hurdles.length;
    const hType = typePattern[hurdleIndex % typePattern.length];

    let railH = 1.05;
    if (hType === 0) {
      // Small/Low hurdle
      railH = 0.82 + Math.random() * 0.06;
    } else if (hType === 1) {
      // Medium hurdle
      railH = 1.08 + Math.random() * 0.08;
    } else {
      // Tall hurdle
      railH = 1.32 + Math.random() * 0.10;
    }

    const style = Math.floor(Math.random() * 5); // 5 visual hurdle variations
    this.hurdles.push({
      x:       GC.world.spawnX,
      height:  railH,
      style:   style,
      cleared: false,
    });
  }

  togglePause() {
    if (this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      Sound.stopGallop();
      if (Sound.bgMusic && typeof Sound.bgMusic.pause === 'function') {
        try { Sound.bgMusic.pause(); } catch(e){}
      }
      showScreen('screenPause');
      const btn = document.getElementById('pauseBtn');
      if (btn) btn.textContent = '▶';
    } else if (this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.lastTime = performance.now();
      Sound.startMusic();
      showScreen(null);
      const btn = document.getElementById('pauseBtn');
      if (btn) btn.textContent = '⏸';
    }
  }

  update(dt) {
    if (this.state === STATE.PAUSED) {
      Sound.stopGallop();
      return;
    }
    if (this.state !== STATE.PLAYING) {
      Sound.stopGallop();
      return;
    }

    const diff  = this.getDiff();
    const speed = diff.speed;
    this.timePlayed += dt;

    // Track distance traveled for world elements
    this.distanceTraveled += speed * dt;

    /* -- Finish gate synchronisation --
       remaining course = hurdles still to clear x the CURRENT average gap
       distance. The gate closes at true world speed and re-anchors gently, so
       reaching it always coincides with 100% progress. */
    {
      const remaining = Math.max(0, this.hurdlesToWin - this.hurdlesCleared);
      const gapDist   = speed * ((diff.gapMs[0] + diff.gapMs[1]) / 2000);
      // anchor on the NEXT hurdle ahead, so the final hurdle and the finish
      // line are the same moment: clearing it carries the rider through the arch
      let next = 0;
      for (const h of this.hurdles) if (h.x > 0 && (next === 0 || h.x < next)) next = h.x;
      const est = remaining > 0 ? Math.max(0, (remaining - 1) * gapDist + next) : 0;
      this.finishDistance = Math.max(0, this.finishDistance - speed * dt);
      // converge harder as the finish approaches so crossing == 100%
      const k = remaining <= 2 ? 6.0 : 0.8;
      this.finishDistance += (est - this.finishDistance) * Math.min(1, dt * k);
    }

    // Countdown Timer Logic
    if (TIMER_CONFIG.enabled) {
      this.elapsedTime += dt;
      this.remainingTime = Math.max(0, TIMER_CONFIG.initialSeconds - this.elapsedTime);
      if (this.remainingTime <= 0) {
        this.timeOut();
        return;
      }
    }

    if (!this.isAirborne) {
      Sound.updateGallop(dt, speed);
    } else {
      Sound.stopGallop();
    }

    /* -- Jump physics -- */
    if (this.isAirborne) {
      this.jumpY  += this.jumpVY * dt;
      this.jumpVY -= GC.player.gravity * dt;
      if (this.jumpY <= 0) {
        this.jumpY  = 0;
        this.jumpVY = 0;
        this.isAirborne = false;
        this.animState  = ANIM.RUN;
        this.animFrame  = 0;
        this.animTimer  = 0;
        this.env.triggerLandingDust();
        Sound.land();
      }
    }

    /* -- Animation timing -- */
    this.animTimer += dt;
    if (this.animState === ANIM.RUN) {
      if (this.animTimer >= GC.player.runFrameTime) {
        this.animTimer = 0;
        this.animFrame = (this.animFrame + 1) % 3;
      }
    } else if (this.animState === ANIM.JUMP) {
      if (this.animTimer >= 0.08) {
        this.animTimer = 0;
        this.animFrame = (this.animFrame + 1) % 3;
      }
    }

    /* -- Hurdle spawn -- */
    this.spawnTimer -= dt * 1000;
    if (this.spawnTimer <= 0 && this.hurdles.length < 5) {
      this.spawnHurdle();
      const [mn, mx] = diff.gapMs;
      this.spawnTimer = mn + Math.random() * (mx - mn);
    }

    /* -- Move & collide hurdles -- */
    for (let i = this.hurdles.length - 1; i >= 0; i--) {
      const h = this.hurdles[i];
      h.x -= speed * dt;

      /* Collision: horse at X=0, check X proximity and height */
      const hX = Math.abs(h.x);
      const inRange = hX < GC.collision.hurdleHalfX;

      if (inRange && !h.attempted) {
        h.attempted = true;
        this.hurdlesAttempted++;
      }

      if (inRange && this.state === STATE.PLAYING && this.timePlayed > GC.player.gracePeriod) {
        const horseBottom = GC.collision.horseBoxY0 + this.jumpY;
        const cleared = horseBottom >= h.height;
        if (!cleared) {
          this.gameOver();
          return;
        }
      }

      /* Cleared: hurdle passed horse */
      if (!h.cleared && h.x < -GC.collision.hurdleHalfX - 0.5) {
        h.cleared = true;
        this.firstHurdlePassed = true;
        this.hurdlesCleared++;
        Sound.clear();
        this.env.triggerClearEffect();
        spawnFloatingText('+1% OFF');

        // Progress is tied to the 15-hurdle course (15 cleared = 100% = the 15% cap)
        const p = Math.min(100, Math.round((this.hurdlesCleared / this.hurdlesToWin) * 100));
        this.setProgress(p);

        if (this.hurdlesCleared >= this.hurdlesToWin) {
          this.setProgress(100);
          this.victory();
          return;
        }

        if (this.state !== STATE.PLAYING) return;
      }

      /* Remove far-behind hurdles */
      if (h.x < GC.world.recycleX) {
        this.hurdles.splice(i, 1);
      }
    }

    updateHUD(this);
  }

  loop(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.state === STATE.START) {
      // Idle animation
      this.idleTimer += dt;
      if (this.idleTimer >= GC.player.idleFrameTime) {
        this.idleTimer = 0;
        this.idleFrame = (this.idleFrame + 1) % 2;
      }
      this.animState = ANIM.IDLE;
      this.animFrame = this.idleFrame;
      this.env.syncHorse(0, ANIM.IDLE, this.idleFrame, STATE.START);
      // the arena stays alive behind the start card
      this.env.renderIdle(dt);
    } else {
      this.update(dt);
      // after the win the arch keeps travelling past the rider with the world
      if (this.state === STATE.VICTORY && this.finishDistance > -60) {
        this.finishDistance -= getDifficulty(100).speed * dt;
      }
      this.env.render(dt, this);
    }

    requestAnimationFrame(t => this.loop(t));
  }
}

/* ====================== UI HELPERS ======================================== */
function updateHUD(game) {
  const pct = Math.floor(game.progress);
  document.getElementById('progressPill').innerHTML = `PROGRESS: <b>${pct}%</b>`;
  document.getElementById('progressFill').style.width = pct + '%';
  
  const stats = game.getStats ? game.getStats() : { firstHurdlePassed: game.hurdlesCleared > 0 };
  const reward = calculateReward(game.progress, game.elapsedTime, game.remainingTime, stats);
  document.getElementById('rewardPill').innerHTML = `REWARD: <b>${reward}% OFF</b>`;

  // Timer HUD update
  const timerPill = document.getElementById('timerPill');
  const timerVal  = document.getElementById('timerVal');
  if (timerPill && timerVal) {
    const sec = Math.max(0, game.remainingTime);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(2);
    timerVal.textContent = `${m.toString().padStart(2,'0')}:${s.padStart(5,'0')}`;
    
    timerPill.classList.toggle('warning', sec <= TIMER_CONFIG.warningSeconds && sec > TIMER_CONFIG.criticalSeconds);
    timerPill.classList.toggle('critical', sec <= TIMER_CONFIG.criticalSeconds);
  }
}

function flashHardModeBanner(text = 'LEVEL UP!', color = '#ffe89c') {
  const el = document.getElementById('hardModeBanner');
  if (!el) return;
  el.textContent = text;
  if (color) el.style.borderColor = color;
  el.classList.add('show');
  if (el._timer) clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 1600);
}

function spawnFloatingText(text) {
  const layer = document.getElementById('feedbackLayer');
  const el = document.createElement('div');
  el.className = 'float-pop';
  el.textContent = text;
  el.style.left = '22%';
  el.style.top  = '40%';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function showScreen(id) {
  document.querySelectorAll('.overlay').forEach(el => el.classList.remove('active'));
  const hint = document.getElementById('startHint');
  hint.style.display = (id === null) ? 'block' : 'none';
  if (id) document.getElementById(id).classList.add('active');
}

/* ====================== BOOT ============================================== */
(async function init() {
  await loadAllAssets();

  const env  = new ThreeEnv();
  const game = new Game(env);

  const regForm = document.getElementById('regForm');
  const regError = document.getElementById('regError');
  const btnRegister = document.getElementById('btnRegister');

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const mobile = document.getElementById('regMobile').value.trim();

      if (!name || !mobile) {
        if (regError) regError.textContent = 'Please fill out all registration fields.';
        return;
      }
      if (!/^[6-9]\d{9}$/.test(mobile)) {
        if (regError) regError.textContent = 'Please enter a valid 10-digit Indian mobile number (starts with 6, 7, 8, or 9).';
        return;
      }

      if (regError) regError.textContent = '';
      if (btnRegister) {
        btnRegister.disabled = true;
        btnRegister.textContent = 'VERIFYING...';
      }

      const existing = await checkExistingPlayer(mobile);

      if (btnRegister) {
        btnRegister.disabled = false;
        btnRegister.textContent = 'VERIFY & CONTINUE \u2794';
      }

      if (existing && (existing.completed || (existing.attempts_used >= 3))) {
        const prevReward = existing.best_reward || existing.reward || '0% OFF';
        const prevName = existing.name || name;
        const prevNum = parseInt(prevReward) || 0;
        const code = generateCouponCode(prevNum, mobile);

        const pName = document.getElementById('blockedPlayerName');
        const pInfo = document.getElementById('blockedPlayerInfo');
        const pRew = document.getElementById('blockedReward');
        const pCode = document.getElementById('blockedCouponVal');
        if (pName) pName.textContent = prevName;
        if (pInfo) pInfo.textContent = `Mobile: ${mobile}`;
        if (pRew) pRew.textContent = prevReward;
        if (pCode) pCode.textContent = code;
        showScreen('screenBlocked');
        return;
      }

      let playerRecord = existing;
      if (!playerRecord) {
        playerRecord = await savePlayerRecord(name, mobile);
      }
      game.player = playerRecord;

      const welcomeText = document.getElementById('startWelcomeText');
      if (welcomeText) {
        const attemptsUsed = parseInt(playerRecord.attempts_used) || 0;
        const attemptsLeft = Math.max(1, 3 - attemptsUsed);
        welcomeText.innerHTML = `Welcome <b>${name}</b>! Verification successful. You have <b>${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'}</b> to clear 20 hurdles and win up to <b>20% OFF</b> your ticket!`;
      }

      showScreen('screenStart');
    });
  }

  const btnStart = document.getElementById('btnStart');
  if (btnStart) btnStart.addEventListener('click', () => game.start());

  // Retry / Claim listeners for Game Over card
  const btnRetryOver = document.getElementById('btnRetryOver');
  if (btnRetryOver) btnRetryOver.addEventListener('click', () => game.start());
  const btnClaimOver = document.getElementById('btnClaimOver');
  if (btnClaimOver) btnClaimOver.addEventListener('click', () => game.claimDiscount('over'));

  // Retry / Claim listeners for Timeout card
  const btnRetryTimeout = document.getElementById('btnRetryTimeout');
  if (btnRetryTimeout) btnRetryTimeout.addEventListener('click', () => game.start());
  const btnClaimTimeout = document.getElementById('btnClaimTimeout');
  if (btnClaimTimeout) btnClaimTimeout.addEventListener('click', () => game.claimDiscount('time'));

  // Copy Coupon Code button event listeners
  const copyBtnMap = {
    'btnCopyBlocked': 'blockedCouponVal',
    'btnCopyOver': 'overCouponVal',
    'btnCopyTime': 'timeCouponVal',
    'btnCopyVictory': 'victoryCouponVal'
  };
  Object.keys(copyBtnMap).forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        copyCouponCode(copyBtnMap[btnId], btn);
      });
    }
  });

  document.getElementById('startHint').style.display = 'none';

  // debug/QA handle (harmless in production, lets the console inspect state)
  if (typeof window !== 'undefined') window.DERBY_GAME = game;

  requestAnimationFrame(t => { game.lastTime = t; game.loop(t); });
})();
