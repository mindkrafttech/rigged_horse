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

const REWARD_CONFIG = {
  minimum: 0,                   // Minimum discount (0% if 1st hurdle missed)
  maximum: 100,                 // Maximum discount cap
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
    jumpVelocity: 11.5,   // punchy upward velocity
    gravity: 28,           // high gravity for narrow jump timing window
    runFrameTime: 0.050,   // ultra fast gallop frame
    idleFrameTime: 0.38,
    horseHeight: 3.4,      // majestic horse height
    horseAspect: 1.55,     // sprite width/height ratio
    gracePeriod: 0.5,      // immediate timing requirement for 1st hurdle
  },
  collision: {
    horseBoxY0: 0.35, // collision box bottom
    horseBoxY1: 2.8,  // collision box top
    hurdleHalfX: 0.45, // hurdle collision half-width in X
  },
  progression: {
    totalHurdles: 20, // 20 hurdles total
    hardModeUnlock: 50,
    completion: 100,
  },
  difficulty: [
    { minPct: 0,   speed: 19.0, gapMs: [1000, 1600], railH: 1.40 }, // ULTRA FAST starting speed & tall 1st hurdle!
    { minPct: 10,  speed: 20.5, gapMs: [900,  1450], railH: 1.42 },
    { minPct: 25,  speed: 22.0, gapMs: [850,  1300], railH: 1.45 },
    { minPct: 50,  speed: 24.5, gapMs: [750,  1150], railH: 1.48 }, // HARD MODE SPIKE
    { minPct: 75,  speed: 26.5, gapMs: [680,  1000], railH: 1.52 },
    { minPct: 90,  speed: 28.5, gapMs: [600,   900], railH: 1.58 },
  ],
};

/* ----------------------------- GAME STATES -------------------------------- */
const STATE = { START: 0, PLAYING: 1, GAME_OVER: 2, VICTORY: 3, TIMEOUT: 4 };
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

  // Attempt to pre-load optional custom audio files from sprites/ or audio/ folder
  try {
    const gAudio = new Audio('sprites/gallop.mp3');
    gAudio.loop = true;
    gAudio.volume = 0.5;
    gAudio.addEventListener('canplaythrough', () => { customGallopAudio = gAudio; hasCustomGallop = true; });

    const mAudio = new Audio('sprites/music.mp3');
    mAudio.loop = true;
    mAudio.volume = 0.4;
    mAudio.addEventListener('canplaythrough', () => { customMusicAudio = mAudio; hasCustomMusic = true; });
  } catch(e){}

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
  const cleared = (stats && stats.hurdlesCleared !== undefined) ? stats.hurdlesCleared : 0;
  const firstPassed = (stats && stats.firstHurdlePassed !== undefined) ? stats.firstHurdlePassed : (cleared > 0);

  // Missing 1st hurdle = 0% discount
  if (REWARD_CONFIG.firstHurdleRequired && !firstPassed) {
    return 0;
  }

  // 1% discount for each hurdle successfully cleared!
  const reward = cleared * REWARD_CONFIG.discountPerHurdle;
  return Math.min(REWARD_CONFIG.maximum, Math.max(0, reward));
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

// Procedural dirt runway canvas texture generator
function createDirtTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#825c2d';
  ctx.fillRect(0, 0, 512, 512);

  // Directional dirt streaks & clay grain
  for (let i = 0; i < 450; i++) {
    const y = Math.random() * 512;
    const h = 1 + Math.random() * 3;
    const a = 0.05 + Math.random() * 0.14;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(168, 124, 70, ${a})` : `rgba(82, 50, 20, ${a})`;
    ctx.fillRect(0, y, 512, h);
  }

  // Fine sand noise
  const img = ctx.getImageData(0, 0, 512, 512);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    data[i]   = Math.max(0, Math.min(255, data[i] + n));
    data[i+1] = Math.max(0, Math.min(255, data[i+1] + n));
    data[i+2] = Math.max(0, Math.min(255, data[i+2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 1);
  return tex;
}

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

/* ========================= THREE.JS ENVIRONMENT =========================== */
class ThreeEnv {
  constructor() {
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;
    this.clock    = new THREE.Clock();

    this.scrollX  = 0;  // cumulative world scroll
    this.speed    = 8;  // current world speed

    // Camera animation
    this.camTarget = new THREE.Vector3(-1, 4.5, 12);
    this.camLook   = new THREE.Vector3(6, 1, 0);
    this.camSwayAmp = 0;

    // Dust particles
    this.dustParticles = null;
    this.dustVels = [];
    this.dustLife = [];
    this.dustActive = [];
    this.DUST_COUNT = 60;

    this.init();
  }

  /* ----- Renderer & Scene ----- */
  init() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 1.5, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.FogExp2(0xb8ddf0, 0.018);

    const W = canvas.parentElement.clientWidth || 800;
    const H = canvas.parentElement.clientHeight || 500;
    this.camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 200);
    this.camera.position.set(-1, 4.5, 12);
    this.camera.lookAt(6, 1, 0);

    this.buildLighting();
    this.buildSky();
    this.buildMountains();
    this.buildGround();
    this.buildForegroundGrass();
    this.buildCurbs();
    this.buildFence();
    this.buildBanners();
    this.buildTrees();
    this.buildClouds();
    this.buildHurdlePool();
    this.buildHorse();
    this.buildDust();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const stage = document.getElementById('stage');
    const W = stage.clientWidth, H = stage.clientHeight;
    this.renderer.setSize(W, H);
    this.camera.aspect = W / H;

    // On narrow mobile screens (portrait), adapt FOV so horse & track remain in view
    if (this.camera.aspect < 1.1) {
      this.camera.fov = Math.min(75, 58 / Math.max(0.55, this.camera.aspect));
    } else {
      this.camera.fov = 58;
    }
    this.camera.updateProjectionMatrix();
  }

  /* ----- Lighting ----- */
  buildLighting() {
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3d6b30, 0.75);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff5d0, 1.5);
    sun.position.set(20, 35, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 80;
    sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
    sun.shadow.camera.top  =  20; sun.shadow.camera.bottom = -20;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    this.sun = sun;

    // Ambient fill
    this.scene.add(new THREE.AmbientLight(0xffeedd, 0.3));
  }

  /* ----- Sky gradient dome ----- */
  buildSky() {
    const geo = new THREE.SphereGeometry(150, 16, 8);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor:    { value: new THREE.Color(0x0066cc) },
        bottomColor: { value: new THREE.Color(0xbde8f5) },
        horizon:     { value: 0.35 },
        exp:         { value: 0.5 },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform vec3 topColor, bottomColor; uniform float horizon, exp;
        varying vec3 vPos;
        void main() {
          float h = clamp((normalize(vPos).y + horizon) / (1.0 + horizon), 0.0, 1.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, exp)), 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  /* ----- 3D Mountains Background ----- */
  buildMountains() {
    this.mountains = [];
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x3d4b5c, flatShading: true });
    const snowMat = new THREE.MeshLambertMaterial({ color: 0xf0f6ff, flatShading: true });

    const count = 18;
    for (let i = 0; i < count; i++) {
      const w = 24 + Math.random() * 18;
      const h = 20 + Math.random() * 16;
      const geo = new THREE.ConeGeometry(w, h, 5);
      const m = new THREE.Mesh(geo, rockMat);
      const x = -130 + i * 16 + (Math.random() - 0.5) * 6;
      const z = -60 - Math.random() * 30;
      m.position.set(x, h / 2 - 3, z);
      this.scene.add(m);

      // Snow peak
      const snowGeo = new THREE.ConeGeometry(w * 0.36, h * 0.36, 5);
      const snow = new THREE.Mesh(snowGeo, snowMat);
      snow.position.set(x, h * 0.82 - 3, z);
      this.scene.add(snow);

      this.mountains.push({ rock: m, snow, baseX: x, z, speed: 0.02 });
    }
  }

  /* ----- Ground & Track ----- */
  buildGround() {
    // Vast grass plane
    const grassGeo = new THREE.PlaneGeometry(300, 80);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x3d6b38 });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.01, -5);
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Dirt racing lane with procedural dirt canvas texture & bump detail
    const trackGeo = new THREE.PlaneGeometry(300, 7);
    this.dirtTex = createDirtTexture();
    this.trackMat = new THREE.MeshLambertMaterial({ map: this.dirtTex, color: 0xa87c42 });
    const track = new THREE.Mesh(trackGeo, this.trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0, 0);
    track.receiveShadow = true;
    this.scene.add(track);

    // Track edge lines (white strips)
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [-3.3, 3.3].forEach(z => {
      const eGeo = new THREE.PlaneGeometry(300, 0.18);
      const edge = new THREE.Mesh(eGeo, edgeMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(0, 0.005, z);
      this.scene.add(edge);
    });

    // Scrolling dashes
    this.dashPool = [];
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true });
    for (let i = 0; i < 25; i++) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.12), dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(i * 10 - 100, 0.006, 0.3);
      this.scene.add(d);
      this.dashPool.push(d);
    }
    this.dashSpacing = 10;
  }

  /* ----- Layer 6: Foreground Grass Tufts (Fast Parallax) ----- */
  buildForegroundGrass() {
    this.fgGrassPool = [];
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x467832, side: THREE.DoubleSide });
    const tuftGeo  = new THREE.ConeGeometry(0.35, 0.7, 4);

    const COUNT = 32;
    for (let i = 0; i < COUNT; i++) {
      const g = new THREE.Mesh(tuftGeo, grassMat);
      const x = i * 4 - 40;
      const z = 4.8 + Math.random() * 0.8;
      g.position.set(x, 0.35, z);
      g.rotation.z = (Math.random() - 0.5) * 0.3;
      this.scene.add(g);
      this.fgGrassPool.push({ mesh: g, baseX: x });
    }
  }

  /* ----- 3D Red & White Runway Curbs ----- */
  buildCurbs() {
    this.curbPool = [];
    const redMat   = new THREE.MeshLambertMaterial({ color: 0xc82424 });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
    const curbGeo  = new THREE.BoxGeometry(1.8, 0.12, 0.22);

    const COUNT = 60;
    for (let i = 0; i < COUNT; i++) {
      const mat = (i % 2 === 0) ? redMat : whiteMat;
      [-3.4, 3.4].forEach(z => {
        const curb = new THREE.Mesh(curbGeo, mat);
        curb.position.set(i * 1.8 - 50, 0.04, z);
        curb.receiveShadow = true;
        this.scene.add(curb);
        this.curbPool.push({ mesh: curb, baseX: i * 1.8 - 50, z });
      });
    }
    this.curbTotalW = COUNT * 1.8;
  }

  /* ----- Tournament Banners on Fence ----- */
  buildBanners() {
    this.bannerPool = [];
    const colors = [0x7a2331, 0xc9a24b, 0x1b3b6f, 0x3f6b3f];
    const bannerGeo = new THREE.PlaneGeometry(3.6, 0.55);

    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
      const c = colors[i % colors.length];
      const mat = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
      const b = new THREE.Mesh(bannerGeo, mat);
      const x = i * 12 - 80;
      b.position.set(x, 0.45, -4.55);
      this.scene.add(b);
      this.bannerPool.push({ mesh: b, baseX: x });
    }
  }

  /* ----- Fence ----- */
  buildFence() {
    const postMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
    const railMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });

    this.fenceGroups = [];
    const COUNT = 28;
    const SPACING = 4;

    for (let i = 0; i < COUNT; i++) {
      const g = new THREE.Group();

      // Post
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), postMat);
      post.position.set(0, 0.65, 0);
      post.castShadow = true;
      g.add(post);

      // Rails (two horizontal)
      [0.85, 0.45].forEach(h => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(SPACING + 0.1, 0.1, 0.08), railMat);
        rail.position.set(SPACING / 2, h, 0);
        g.add(rail);
      });

      // Place two lanes: far (Z=-4.6) and near (Z=4.6)
      [-4.6, 4.6].forEach(z => {
        const clone = g.clone();
        clone.position.set(i * SPACING - COUNT * SPACING / 2, 0, z);
        this.scene.add(clone);
        this.fenceGroups.push({ mesh: clone, z, baseX: i * SPACING - COUNT * SPACING / 2 });
      });
    }
    this.fenceSpacing = SPACING;
    this.fenceTotalWidth = COUNT * SPACING;
  }

  /* ----- Trees ----- */
  buildTrees() {
    this.treeMeshes = [];
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
    const leafColors = [0x2d5a1b, 0x3a7025, 0x224d14, 0x3d6b20, 0x2a5518];

    const positions = [];
    for (let x = -120; x < 120; x += 6 + Math.random() * 5) {
      // Far side
      positions.push({ x, z: -7 - Math.random() * 8, s: 0.7 + Math.random() * 0.9, far: true });
      // Very far side (smaller)
      if (Math.random() > 0.4) positions.push({ x: x + 3, z: -13 - Math.random() * 8, s: 0.5 + Math.random() * 0.5, far: false });
    }

    positions.forEach(({ x, z, s, far }) => {
      const trunkH = 0.9 * s;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, trunkH, 6), trunkMat);
      trunk.position.set(x, trunkH / 2, z);
      trunk.castShadow = true;
      this.scene.add(trunk);

      // 1-2 leaf layers
      const leafColor = leafColors[Math.floor(Math.random() * leafColors.length)];
      const leafMat = new THREE.MeshLambertMaterial({ color: leafColor });
      const lh = 2.2 * s;
      const lr = 1.0 * s;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(lr, lh, 7), leafMat);
      leaf.position.set(x, trunkH + lh / 2, z);
      leaf.castShadow = true;
      this.scene.add(leaf);

      if (s > 0.9) {
        // Second cone for taller trees
        const leaf2 = new THREE.Mesh(new THREE.ConeGeometry(lr * 0.65, lh * 0.75, 7), leafMat);
        leaf2.position.set(x, trunkH + lh * 0.85, z);
        this.scene.add(leaf2);
        this.treeMeshes.push({ trunk, leaf, leaf2, baseX: x, z, speed: far ? 0.12 : 0.06 });
      } else {
        this.treeMeshes.push({ trunk, leaf, leaf2: null, baseX: x, z, speed: far ? 0.12 : 0.06 });
      }
    });
  }

  /* ----- Clouds ----- */
  buildClouds() {
    this.clouds = [];
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.75, transparent: true });

    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const parts = 2 + Math.floor(Math.random() * 3);
      for (let p = 0; p < parts; p++) {
        const r = 1.5 + Math.random() * 2;
        const c = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), cloudMat);
        c.position.set((p - parts / 2) * 2.5, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.5);
        g.add(c);
      }
      g.position.set(-80 + i * 18 + Math.random() * 8, 10 + Math.random() * 5, -25 - Math.random() * 20);
      this.scene.add(g);
      this.clouds.push({ group: g, speed: 0.3 + Math.random() * 0.4 });
    }
  }

  /* ----- Hurdle Pool (5 Visual Styles, Same Collision) ----- */
  buildHurdlePool() {
    this.hurdleStyleMats = [
      // Style 0: Classic Championship (Red & White)
      { post: new THREE.MeshLambertMaterial({ color: 0xf8f8f8 }), rail: new THREE.MeshLambertMaterial({ color: 0xcc2200 }), base: new THREE.MeshLambertMaterial({ color: 0xd4a820 }), flag: new THREE.MeshLambertMaterial({ color: 0xcc2200 }) },
      // Style 1: Rustic Timber (Dark Oak & Iron)
      { post: new THREE.MeshLambertMaterial({ color: 0x4a3219 }), rail: new THREE.MeshLambertMaterial({ color: 0xeeeeee }), base: new THREE.MeshLambertMaterial({ color: 0x2a2a2a }), flag: new THREE.MeshLambertMaterial({ color: 0xc9a24b }) },
      // Style 2: Turf Emerald (Green & White)
      { post: new THREE.MeshLambertMaterial({ color: 0xf8f8f8 }), rail: new THREE.MeshLambertMaterial({ color: 0x1f5e2b }), base: new THREE.MeshLambertMaterial({ color: 0x2d5a1b }), flag: new THREE.MeshLambertMaterial({ color: 0x1f5e2b }) },
      // Style 3: Floral Derby (Bright White & Flowers)
      { post: new THREE.MeshLambertMaterial({ color: 0xffffff }), rail: new THREE.MeshLambertMaterial({ color: 0xe63946 }), base: new THREE.MeshLambertMaterial({ color: 0x457b9d }), flag: new THREE.MeshLambertMaterial({ color: 0xe63946 }) },
      // Style 4: Grand Gold Cup (Imperial Navy & Gold)
      { post: new THREE.MeshLambertMaterial({ color: 0x1b2b4c }), rail: new THREE.MeshLambertMaterial({ color: 0xd4a820 }), base: new THREE.MeshLambertMaterial({ color: 0x1b2b4c }), flag: new THREE.MeshLambertMaterial({ color: 0xd4a820 }) },
    ];

    const postGeo  = new THREE.BoxGeometry(0.28, 1.8, 0.28);
    const railGeo  = new THREE.BoxGeometry(0.22, 0.16, 6.5);
    const baseGeo  = new THREE.BoxGeometry(0.5, 0.18, 0.8);
    const flagGeo  = new THREE.BoxGeometry(0.5, 0.35, 0.04);

    this.hurdlePool = [];
    const POOL_SIZE = 8;

    for (let i = 0; i < POOL_SIZE; i++) {
      const g = new THREE.Group();

      const lPost = new THREE.Mesh(postGeo, this.hurdleStyleMats[0].post);
      lPost.position.set(0, 0.9, -3.25);
      lPost.castShadow = true;
      g.add(lPost);

      const rPost = new THREE.Mesh(postGeo, this.hurdleStyleMats[0].post);
      rPost.position.set(0, 0.9, 3.25);
      rPost.castShadow = true;
      g.add(rPost);

      const rail = new THREE.Mesh(railGeo, this.hurdleStyleMats[0].rail);
      rail.castShadow = true;
      g.add(rail);

      const rail2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 6.5), this.hurdleStyleMats[0].post);
      g.add(rail2);

      const bases = [];
      [-3.25, 3.25].forEach(z => {
        const base = new THREE.Mesh(baseGeo, this.hurdleStyleMats[0].base);
        base.position.set(0, 0.09, z);
        g.add(base);
        bases.push(base);
      });

      const flags = [];
      [-3.25, 3.25].forEach(z => {
        const flag = new THREE.Mesh(flagGeo, this.hurdleStyleMats[0].flag);
        flag.position.set(0, 1.85, z + (z > 0 ? -0.18 : 0.18));
        g.add(flag);
        flags.push(flag);
      });

      g.visible = false;
      g.position.set(50, 0, 0);
      this.scene.add(g);

      this.hurdlePool.push({
        group: g,
        active: false,
        lPost, rPost, rail, rail2, bases, flags,
        gameHurdle: null,
      });
    }
  }

  /* ----- Horse Sprite Billboard ----- */
  buildHorse() {
    const H = GC.player.horseHeight;
    const W = H * GC.player.horseAspect;

    const geo = new THREE.PlaneGeometry(W, H);
    // Default to idleA texture, will be switched
    const texKey = TEXTURES.idleA ? 'idleA' : Object.keys(TEXTURES)[0];
    const mat = new THREE.MeshBasicMaterial({
      map: TEXTURES[texKey] || null,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.horseMesh = new THREE.Mesh(geo, mat);
    // Fixed X position: horse at x=GC.world.horseX, z slightly toward camera
    this.horseMesh.position.set(GC.world.horseX, H / 2, 0.8);
    this.horseMesh.renderOrder = 10;
    this.scene.add(this.horseMesh);

    // Pre-build material set
    this.horseMats = {};
    for (const k of Object.keys(TEXTURES)) {
      this.horseMats[k] = new THREE.MeshBasicMaterial({
        map: TEXTURES[k],
        transparent: true,
        alphaTest: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    }

    // Shadow ellipse
    const shadowGeo = new THREE.CircleGeometry(1.2, 14);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0.25,
      transparent: true,
      depthWrite: false,
    });
    this.horseShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.horseShadow.rotation.x = -Math.PI / 2;
    this.horseShadow.position.set(GC.world.horseX, 0.01, 0.8);
    this.horseShadow.renderOrder = 5;
    this.scene.add(this.horseShadow);
  }

  /* ----- Dust Particles ----- */
  buildDust() {
    const N = this.DUST_COUNT;
    const posArr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) posArr[i * 3 + 1] = -100; // hide below ground

    const geo = new THREE.BufferGeometry();
    this.dustPosAttr = new THREE.BufferAttribute(posArr, 3);
    geo.setAttribute('position', this.dustPosAttr);

    const mat = new THREE.PointsMaterial({
      size: 0.22,
      color: 0xc4a87a,
      transparent: true,
      opacity: 0.65,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.dustParticles = new THREE.Points(geo, mat);
    this.dustParticles.renderOrder = 8;
    this.scene.add(this.dustParticles);

    for (let i = 0; i < N; i++) {
      this.dustVels.push({ x: 0, y: 0, z: 0 });
      this.dustLife.push(0);
      this.dustActive.push(false);
    }
  }

  emitDust(x, y, z, count = 8, intensity = 1.0) {
    let emitted = 0;
    for (let i = 0; i < this.DUST_COUNT && emitted < count; i++) {
      if (!this.dustActive[i]) {
        this.dustActive[i] = true;
        const pa = this.dustPosAttr.array;
        pa[i*3]   = x + (Math.random()-0.5)*0.5;
        pa[i*3+1] = y;
        pa[i*3+2] = z + (Math.random()-0.5)*0.4;
        this.dustVels[i].x = (Math.random()-0.5)*2.5*intensity;
        this.dustVels[i].y = (0.5 + Math.random()*1.5)*intensity;
        this.dustVels[i].z = (Math.random()-0.5)*0.5;
        this.dustLife[i]   = 0.4 + Math.random()*0.3;
        emitted++;
      }
    }
    this.dustPosAttr.needsUpdate = true;
  }

  updateDust(dt) {
    const pa = this.dustPosAttr.array;
    let any = false;
    for (let i = 0; i < this.DUST_COUNT; i++) {
      if (this.dustActive[i]) {
        this.dustLife[i] -= dt;
        if (this.dustLife[i] <= 0) {
          this.dustActive[i] = false;
          pa[i*3+1] = -100;
        } else {
          pa[i*3]   += this.dustVels[i].x * dt;
          pa[i*3+1] += this.dustVels[i].y * dt;
          pa[i*3+2] += this.dustVels[i].z * dt;
          this.dustVels[i].y -= 4 * dt;
          pa[i*3+1] = Math.max(0.1, pa[i*3+1]);
          any = true;
        }
      }
    }
    if (any) this.dustPosAttr.needsUpdate = true;
  }

  /* ----- External triggers ----- */
  triggerLandingDust() {
    this.emitDust(GC.world.horseX - 0.3, 0.1, 0.8, 18, 1.6);
  }
  triggerJumpDust() {
    this.emitDust(GC.world.horseX - 0.5, 0.1, 0.8, 10, 1.0);
  }
  triggerClearEffect() {
    // Gold burst at hurdle position
    this.emitDust(GC.world.horseX + 1, 1.2, 0, 12, 1.2);
  }

  /* ----- Sync hurdles from game state ----- */
  syncHurdles(gameHurdles) {
    // Deactivate all pool slots
    for (const slot of this.hurdlePool) slot.active = false;

    for (const gh of gameHurdles) {
      // Find or assign a pool slot
      let slot = this.hurdlePool.find(s => s.gameHurdle === gh);
      if (!slot) slot = this.hurdlePool.find(s => !s.active);
      if (!slot) continue;

      slot.active = true;
      slot.gameHurdle = gh;
      slot.group.visible = true;
      slot.group.position.x = gh.x;
      slot.group.position.y = 0;

      // Apply hurdle style materials (5 visual variations)
      const styleIdx = (gh.style !== undefined) ? gh.style : 0;
      const m = this.hurdleStyleMats[styleIdx] || this.hurdleStyleMats[0];
      slot.lPost.material = m.post;
      slot.rPost.material = m.post;
      slot.rail.material  = m.rail;
      slot.rail2.material = m.post;
      if (slot.bases) slot.bases.forEach(b => b.material = m.base);
      if (slot.flags) slot.flags.forEach(f => f.material = m.flag);

      // Position rail at hurdle height
      slot.rail.position.set(0, gh.height, 0);
      slot.rail2.position.set(0, gh.height - 0.25, 0);
      
      // Subtle approach glow: hurdle turns brighter when < 5 units away
      const closeness = Math.max(0, 1 - Math.abs(gh.x) / 5);
      const r = slot.rail;
      if (closeness > 0) {
        r.material.emissive = r.material.emissive || new THREE.Color();
        r.material.emissiveIntensity = closeness * 0.3;
      }
    }

    // Hide inactive slots
    for (const slot of this.hurdlePool) {
      if (!slot.active) {
        slot.group.visible = false;
        slot.gameHurdle = null;
      }
    }
  }

  /* ----- Update horse visual ----- */
  syncHorse(jumpY, animState, animFrame, gameState) {
    const H = GC.player.horseHeight;
    // Horse center Y = ground + half height + jumpY
    this.horseMesh.position.y = H / 2 + jumpY;

    // Dynamic Shadow: shrinks & lightens when airborne, expands/darkens on land
    const shadowScale = Math.max(0.35, 1.2 - jumpY * 0.35);
    const shadowOpacity = Math.max(0.08, 0.28 - jumpY * 0.12);
    this.horseShadow.scale.setScalar(shadowScale);
    this.horseShadow.material.opacity = shadowOpacity;

    // Face camera (billboard around Y axis)
    this.horseMesh.lookAt(this.camera.position);
    this.horseMesh.rotation.y = 0; // sprite faces right (direction of travel)
    this.horseMesh.rotation.x = 0;
    this.horseMesh.rotation.z = 0;

    // Pick texture
    let texKey = 'idleA';
    if (gameState === STATE.GAME_OVER) {
      texKey = 'jumpC';
    } else if (animState === ANIM.JUMP) {
      const vy = this._lastVY || 0;
      if (vy > 2) texKey = 'jumpA';
      else if (vy < -2) texKey = 'jumpC';
      else texKey = 'jumpB';
    } else if (animState === ANIM.RUN) {
      texKey = ['runA','runB','runC'][animFrame % 3];
    } else {
      texKey = ['idleA','idleB'][animFrame % 2];
    }

    const mat = this.horseMats[texKey];
    if (mat && this.horseMesh.material !== mat) {
      this.horseMesh.material = mat;
    }
  }

  /* ----- Scroll world elements ----- */
  scrollWorld(delta, speed) {
    this.scrollX += delta;
    const s = speed;

    // Fence: fast scroll (parallax 0.85x)
    const fenceParallax = 0.85;
    const totalFW = this.fenceTotalWidth;
    for (const f of this.fenceGroups) {
      f.mesh.position.x = f.baseX - (this.scrollX * fenceParallax) % totalFW;
      // Recycle
      const px = f.mesh.position.x;
      if (px < -totalFW / 2 - 20) { f.baseX += totalFW; f.mesh.position.x += totalFW; }
      if (px > totalFW / 2 + 20)  { f.baseX -= totalFW; f.mesh.position.x -= totalFW; }
    }

    // Trees: slow scroll (parallax 0.10-0.15x)
    for (const t of this.treeMeshes) {
      const px = t.baseX - (this.scrollX * t.speed) % 240;
      t.trunk.position.x = px;
      t.leaf.position.x  = px;
      if (t.leaf2) t.leaf2.position.x = px;
      // Recycle trees
      const cx = t.trunk.position.x;
      if (cx < -130) { t.baseX += 240; }
      if (cx > 130)  { t.baseX -= 240; }
    }

    // Dashes: fast scroll
    for (const d of this.dashPool) {
      d.position.x -= s * (1 / 60); // approximate scroll per frame
      // Recycle: if behind camera view
      if (d.position.x < -15) d.position.x += this.dashSpacing * this.dashPool.length;
      if (d.position.x > 50)  d.position.x -= this.dashSpacing * this.dashPool.length;
    }

    // Clouds: very slow
    for (const c of this.clouds) {
      c.group.position.x -= c.speed * (1 / 60);
      if (c.group.position.x < -100) c.group.position.x += 200;
    }
  }

  /* ----- Camera update (Mobile & Desktop Responsive) ----- */
  updateCamera(dt, jumpY, speed, hardMode) {
    const aspect = this.camera.aspect || 1.0;
    const isMobilePortrait = aspect < 1.1;

    // Responsive camera position targets for mobile vs desktop
    const targetZ = (isMobilePortrait ? 15.5 : 12.0) + (hardMode ? 0 : 0.5);
    const targetCamX = isMobilePortrait ? 1.5 : -1.0;

    // Sway amplitude based on speed
    const swayTarget = Math.min(0.12, speed * 0.005);
    this.camSwayAmp += (swayTarget - this.camSwayAmp) * dt * 3;

    const t = performance.now() * 0.001;
    const sway = Math.sin(t * 2.8) * this.camSwayAmp;
    const bounce = Math.sin(t * 5.6) * this.camSwayAmp * 0.3;
    const jumpFollow = jumpY * 0.25;

    const targetY = (isMobilePortrait ? 4.8 : 4.5) + jumpFollow + bounce;

    this.camera.position.x += (targetCamX - this.camera.position.x) * dt * 4;
    this.camera.position.y += (targetY - this.camera.position.y) * dt * 4;
    this.camera.position.z += (targetZ - this.camera.position.z) * dt * 4;

    // Look ahead of horse: on mobile, shift look-at closer to horse (x=0) so horse is fully visible!
    const lookX = (isMobilePortrait ? 3.0 : 5.0) + speed * 0.08 + sway;
    const lookY = 1 + jumpY * 0.12;
    this.camera.lookAt(lookX, lookY, 0);
  }

    // Scroll world elements
  scrollWorld(delta, speed) {
    this.scrollX += delta;
    const s = speed;

    // Mountains: ultra slow parallax (0.02x)
    if (this.mountains) {
      for (const m of this.mountains) {
        const px = m.baseX - (this.scrollX * m.speed) % 260;
        m.rock.position.x = px;
        m.snow.position.x = px;
      }
    }

    // Fence: fast scroll (parallax 0.85x)
    const fenceParallax = 0.85;
    const totalFW = this.fenceTotalWidth;
    for (const f of this.fenceGroups) {
      f.mesh.position.x = f.baseX - (this.scrollX * fenceParallax) % totalFW;
      const px = f.mesh.position.x;
      if (px < -totalFW / 2 - 20) { f.baseX += totalFW; f.mesh.position.x += totalFW; }
      if (px > totalFW / 2 + 20)  { f.baseX -= totalFW; f.mesh.position.x -= totalFW; }
    }

    // Banners: scroll with fence (0.85x)
    if (this.bannerPool) {
      const bannerTotalW = 16 * 12;
      for (const b of this.bannerPool) {
        b.mesh.position.x = b.baseX - (this.scrollX * 0.85) % bannerTotalW;
      }
    }

    // Curbs: scroll with ground (1.0x)
    if (this.curbPool) {
      const curbW = this.curbTotalW;
      for (const c of this.curbPool) {
        c.mesh.position.x = c.baseX - (this.scrollX) % curbW;
      }
    }

    // Foreground grass tufts (1.25x parallax speed)
    if (this.fgGrassPool) {
      const fgTotalW = 32 * 4;
      for (const g of this.fgGrassPool) {
        g.mesh.position.x = g.baseX - (this.scrollX * 1.25) % fgTotalW;
        if (g.mesh.position.x < -30) g.baseX += fgTotalW;
        if (g.mesh.position.x > 70)  g.baseX -= fgTotalW;
      }
    }

    // Trees: slow scroll (parallax 0.10-0.15x)
    for (const t of this.treeMeshes) {
      const px = t.baseX - (this.scrollX * t.speed) % 240;
      t.trunk.position.x = px;
      t.leaf.position.x  = px;
      if (t.leaf2) t.leaf2.position.x = px;
      const cx = t.trunk.position.x;
      if (cx < -130) { t.baseX += 240; }
      if (cx > 130)  { t.baseX -= 240; }
    }

    // Dashes: fast scroll
    for (const d of this.dashPool) {
      d.position.x -= s * (1 / 60);
      if (d.position.x < -15) d.position.x += this.dashSpacing * this.dashPool.length;
      if (d.position.x > 50)  d.position.x -= this.dashSpacing * this.dashPool.length;
    }

    // Clouds: very slow
    for (const c of this.clouds) {
      c.group.position.x -= c.speed * (1 / 60);
      if (c.group.position.x < -100) c.group.position.x += 200;
    }
  }

  /* ----- Main render ----- */
  render(dt, game) {
    if (!game) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const isGameOver = (game.state === STATE.GAME_OVER);
    const speed = isGameOver ? 0 : getDifficulty(game.progress).speed;
    this.speed = speed;

    // Scroll world ONLY when playing (freezes like a statue on hit!)
    if (!isGameOver) {
      this.scrollWorld(speed * dt, speed);
    }

    // Sync horse
    this.syncHorse(game.jumpY, game.animState, game.animFrame, game.state);
    this._lastVY = game.jumpVY;

    // Sync hurdles
    this.syncHurdles(game.hurdles);

    // Dust: continuous hoof dust while running
    if (game.state === STATE.PLAYING && !game.isAirborne && Math.random() < 0.4) {
      this.emitDust(GC.world.horseX - 1.0, 0.08, 0.8, 2, 0.5);
    }
    this.updateDust(dt);

    // Camera
    this.updateCamera(dt, game.jumpY, speed, game.hardMode);

    this.renderer.render(this.scene, this.camera);
  }

  renderStatic() {
    this.updateCamera(0.016, 0, 8, false);
    this.renderer.render(this.scene, this.camera);
  }
}

/* ========================= GAME CLASS ===================================== */
class Game {
  constructor(env) {
    this.env = env;
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
      if (e.code === 'Space' || e.code === 'ArrowUp') jump(e);
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
    this.totalCourseDistance = 720; // 720 world units total course length (~35s at ~20 units/s)
    this.hardMode = false;
    this.hurdlesCleared = 0;
    this.hurdlesAttempted = 0;
    this.firstHurdlePassed = false;

    this.elapsedTime = 0;
    this.remainingTime = TIMER_CONFIG.initialSeconds;

    this.hurdles = [];
    this.spawnTimer = 750; // ultra fast initial delay ~0.75s so first hurdle arrives instantly!
    this.timePlayed = 0;
    this.jumpY  = 0;
    this.jumpVY = 0;
    this.isAirborne = false;
    this.animState = ANIM.RUN;
    this.animFrame = 0;
    this.animTimer = 0;
    this.idleFrame = 0;
    this.idleTimer = 0;
    updateHUD(this);
    setModeUI(false);
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

  gameOver() {
    this.state = STATE.GAME_OVER;
    this.animState = ANIM.HIT;
    Sound.hit();
    Sound.stopGallop();
    Sound.stopMusic();

    const stats = this.getStats();
    const reward = calculateReward(this.progress, this.elapsedTime, this.remainingTime, stats);
    stats.reward = reward;
    this.lastResultData = stats;
    console.log('🏁 GAME OVER RESULT:', stats);

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

    setTimeout(() => showScreen('screenOver'), 500);
  }

  timeOut() {
    this.state = STATE.TIMEOUT;
    Sound.stopGallop();
    Sound.stopMusic();

    const stats = this.getStats();
    const reward = calculateReward(this.progress, this.elapsedTime, 0, stats);
    stats.reward = reward;
    this.lastResultData = stats;
    console.log('🏁 TIMEOUT RESULT:', stats);

    document.getElementById('timeProgress').textContent = stats.progress + '%';
    document.getElementById('timeAccuracy').textContent = Math.round(stats.accuracy * 100) + '%';
    document.getElementById('timeReward').textContent = reward + '% OFF';

    setTimeout(() => showScreen('screenTimeout'), 400);
  }

  victory() {
    this.state = STATE.VICTORY;
    Sound.victory();
    Sound.stopGallop();
    Sound.stopMusic();

    const stats = this.getStats();
    const reward = calculateReward(100, this.elapsedTime, this.remainingTime, stats);
    stats.reward = reward;
    this.lastResultData = stats;
    console.log('🏁 VICTORY RESULT:', stats);

    document.getElementById('victoryTime').textContent = stats.elapsedTime + 's';
    document.getElementById('victoryAccuracy').textContent = Math.round(stats.accuracy * 100) + '%';
    document.getElementById('victoryReward').textContent = reward + '% OFF';

    setTimeout(() => showScreen('screenVictory'), 350);
  }

  setProgress(val) {
    const wasHard = this.hardMode;
    this.progress = Math.min(100, Math.max(0, val));
    if (!wasHard && this.progress >= GC.progression.hardModeUnlock) {
      this.hardMode = true;
      setModeUI(true);
      Sound.hardMode();
      flashHardModeBanner();
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

  update(dt) {
    if (this.state !== STATE.PLAYING) {
      Sound.stopGallop();
      return;
    }

    const diff  = this.getDiff();
    const speed = diff.speed;
    this.timePlayed += dt;

    // Continuous smooth course progress based on distance traveled
    this.distanceTraveled += speed * dt;
    const currentPct = (this.distanceTraveled / this.totalCourseDistance) * 100;
    this.setProgress(currentPct);

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
      // Background scrolls slowly on start screen
      this.env.scrollWorld(6 * dt, 6);
      this.env.updateCamera(dt, 0, 6, false);
      this.env.updateDust(dt);
      this.env.renderer.render(this.env.scene, this.env.camera);
    } else {
      this.update(dt);
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

function setModeUI(hard) {
  const pill = document.getElementById('modePill');
  pill.classList.toggle('hard', hard);
  pill.innerHTML = `MODE: <b>${hard ? 'HARD' : 'NORMAL'}</b>`;
}

function flashHardModeBanner() {
  const el = document.getElementById('hardModeBanner');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
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

  document.getElementById('btnStart').addEventListener('click', () => game.start());
  document.getElementById('btnRetry').addEventListener('click', () => game.start());
  document.getElementById('btnVictoryRestart').addEventListener('click', () => game.start());
  const btnTimeout = document.getElementById('btnTimeoutRetry');
  if (btnTimeout) btnTimeout.addEventListener('click', () => game.start());

  document.getElementById('startHint').style.display = 'none';

  requestAnimationFrame(t => { game.lastTime = t; game.loop(t); });
})();
