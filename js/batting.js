/**
 * 1球入魂！ご褒美バッティング ミニゲームエンジン (BattingGameManager)
 * - 5問正解ごとに発動するプロスピ風の対決バッティング
 * - 対戦相手ルーレット（クラスメイト＆名簿児童が相手投手として登板）
 * - 物理軌道シミュレーション（直球、火の玉、スライダー、フォーク、カーブ）
 * - 実況中継カメラ ＆ リアルタイム打球放物線追尾 ＆ 特大ホームラン演出
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.BattingGameManager = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  // デフォルトのライバル投手データプール（オフライン時・初期用）
  const DEFAULT_RIVAL_PITCHERS = [
    { name: "あたらし ひろと", score: 83, homeruns: 74, maxDistance: 152, title: "豪速球の守護神" },
    { name: "わたなべ", score: 92, homeruns: 62, maxDistance: 154, title: "怪物スラッガー投手" },
    { name: "二宮悠太", score: 80, homeruns: 40, maxDistance: 140, title: "本格派エース" },
    { name: "そうた", score: 55, homeruns: 33, maxDistance: 130, title: "技巧派ドクターK" },
    { name: "あおい", score: 52, homeruns: 28, maxDistance: 135, title: "急降下フォークの使い手" },
    { name: "森くん", score: 31, homeruns: 15, maxDistance: 144, title: "魔球カーブマスター" },
    { name: "柴田", score: 30, homeruns: 28, maxDistance: 130, title: "快速サイドスロー" },
    { name: "翔真", score: 20, homeruns: 8, maxDistance: 110, title: "期待の本格派右腕" },
    { name: "こゆり", score: 9, homeruns: 6, maxDistance: 95, title: "ルーキー投手" }
  ];

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- 内蔵シンセサイザー サウンドエンジン ---
  class BattingSoundEngine {
    constructor() {
      this.ctx = null;
      this.audioHit = null;
      this.audioHomerun = null;
      if (typeof window !== 'undefined') {
        this.audioHit = document.getElementById('audioHit');
        this.audioHomerun = document.getElementById('audioHomerun');
      }
    }

    init() {
      if (!this.ctx && typeof window !== 'undefined') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playClick() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(300, t + 0.04);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.04);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(t + 0.04);
      } catch (e) {}
    }

    playFever() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const notes = [
          { f: 587.33, w: 0.00 },
          { f: 587.33, w: 0.08 },
          { f: 587.33, w: 0.16 },
          { f: 783.99, w: 0.26 },
          { f: 880.00, w: 0.38 },
          { f: 987.77, w: 0.50 },
          { f: 1174.66, w: 0.65 }
        ];
        notes.forEach(note => {
          const st = t + note.w;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(note.f, st);
          gain.gain.setValueAtTime(0.24, st);
          gain.gain.linearRampToValueAtTime(0.01, st + 0.16);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(st);
          osc.stop(st + 0.16);
        });
      } catch (e) {}
    }

    playRouletteTick() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, t);
        osc.frequency.exponentialRampToValueAtTime(450, t + 0.035);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.035);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.035);
      } catch (e) {}
    }

    playRouletteDecided() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const notes = [
          { f: 523.25, d: 0.09 },
          { f: 659.25, d: 0.09 },
          { f: 783.99, d: 0.11 },
          { f: 1046.50, d: 0.35 }
        ];
        let cur = t;
        notes.forEach((n, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = idx === notes.length - 1 ? 'sawtooth' : 'triangle';
          osc.frequency.setValueAtTime(n.f, cur);
          gain.gain.setValueAtTime(0.35, cur);
          gain.gain.linearRampToValueAtTime(0.01, cur + n.d);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(cur);
          osc.stop(cur + n.d);
          cur += n.d;
        });
      } catch (e) {}
    }

    playPlayBall() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1500, t);
        osc.frequency.linearRampToValueAtTime(1700, t + 0.08);
        osc.frequency.linearRampToValueAtTime(1400, t + 0.25);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      } catch (e) {}
    }

    playRelease() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.09);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.09);
      } catch (e) {}
    }

    playWhoosh() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.14);
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.14);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.14);
      } catch (e) {}
    }

    playCatch() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.1);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.1);
      } catch (e) {}
    }

    playHit() {
      if (this.audioHit) {
        try {
          this.audioHit.currentTime = 0;
          this.audioHit.play();
          return;
        } catch (e) {}
      }
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(500, t + 0.08);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
      } catch (e) {}
    }

    playHomerun() {
      if (this.audioHomerun) {
        try {
          this.audioHomerun.currentTime = 0;
          this.audioHomerun.play();
          return;
        } catch (e) {}
      }
      this.playHit();
    }

    playFirework() {
      this.init();
      if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);
        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.4);
      } catch (e) {}
    }

    playCheer() {
      this.init();
      if (!this.ctx) return;
      try {
        const bufferSize = this.ctx.sampleRate * 0.8;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 850;
        filter.Q.value = 1.2;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.8);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
      } catch (e) {}
    }
  }

  // --- バッティングマネージャー本体 ---
  class BattingGameManager {
    constructor(options = {}) {
      this.sound = options.sound || new BattingSoundEngine();
      this.getUsersCallback = options.getUsers || (() => []);
      this.onCompleteCallback = options.onComplete || (() => {});

      this.bCtx = null;
      this.bW = 0;
      this.bH = 0;
      this.bAnimId = null;
      this.bCameraMode = 'BATTER';
      this.bBattingActive = false;
      this.bPitchState = 'IDLE';
      this.bStateStartTime = 0;
      this.bTimers = [];

      this.bStrikeZone = {
        get x() { return this._mgr.bW * 0.5; },
        get y() { return this._mgr.bH * 0.64; },
        get w() { return Math.min(220, this._mgr.bW * 0.28); },
        get h() { return Math.min(250, this._mgr.bH * 0.36); }
      };
      this.bStrikeZone._mgr = this;

      this.bBatCursor = {
        x: 0,
        y: 0,
        radius: 36,
        isSwinging: false,
        swingProgress: 0
      };

      this.bBall = {
        active: false,
        x: 0,
        y: 0,
        speedKmh: 148,
        durationMs: 960,
        startTime: 0,
        targetX: 0,
        targetY: 0,
        hit: false,
        swung: false,
        hitResult: null,
        pitchType: 'STRAIGHT',
        pitchLabel: '直球',
        cornerName: '中央',
        breakDir: 1,
        isMeatball: false
      };

      this.bTrackingBall = {
        active: false,
        startTime: 0,
        durationMs: 2400,
        startX: 0,
        startY: 0,
        apexY: 0,
        endX: 0,
        endY: 0,
        targetDist: 140,
        isHr: false,
        isPerfect: false,
        landed: false,
        currentX: 0,
        currentY: 0,
        currentScale: 1.0,
        trail: []
      };

      this.bParticles = [];
      this.bConfetti = [];
      this.bPitchTrail = [];
      this.currentRivalPitcher = null;
      this.rouletteAnimId = null;

      this.dom = {};
      this.initDom();
      this.bindEvents();
    }

    initDom() {
      if (typeof document === 'undefined') return;
      this.dom = {
        screenBatting: document.getElementById('screen-batting'),
        battingLayerBatter: document.getElementById('batting-layer-batter'),
        battingLayerBroadcast: document.getElementById('batting-layer-broadcast'),
        battingImgBroadcast: document.getElementById('batting-img-broadcast'),
        battingImpactFlash: document.getElementById('batting-impact-flash'),
        battingCanvas: document.getElementById('batting-canvas'),
        battingStatusText: document.getElementById('batting-status-text'),
        battingPlayerStatsBadge: document.getElementById('batting-player-stats-badge'),
        battingRivalCard: document.getElementById('batting-rival-card'),
        battingRivalRankBadge: document.getElementById('batting-rival-rank-badge'),
        battingRivalName: document.getElementById('batting-rival-name'),
        battingRivalSub: document.getElementById('batting-rival-sub'),
        battingRivalSpeed: document.getElementById('batting-rival-speed'),
        battingRivalPitches: document.getElementById('batting-rival-pitches'),
        battingRivalControl: document.getElementById('batting-rival-control'),
        battingPitchCallout: document.getElementById('batting-pitch-callout'),
        battingPitchCalloutType: document.getElementById('batting-pitch-callout-type'),
        battingMeterHud: document.getElementById('batting-meter-hud'),
        battingMeterVal: document.getElementById('batting-meter-val'),
        battingBroadcastTicker: document.getElementById('batting-broadcast-ticker'),
        battingTickerText: document.getElementById('batting-ticker-text'),
        battingHomerunPopup: document.getElementById('batting-homerun-popup'),
        battingHrDistText: document.getElementById('batting-hr-dist-text'),
        battingRouletteModal: document.getElementById('batting-roulette-modal'),
        rouletteReelStrip: document.getElementById('roulette-reel-strip'),
        btnRouletteStop: document.getElementById('btn-roulette-stop'),
        rouletteDecidedCard: document.getElementById('roulette-decided-card'),
        rouletteDecidedRank: document.getElementById('roulette-decided-rank'),
        rouletteDecidedName: document.getElementById('roulette-decided-name'),
        rouletteDecidedSub: document.getElementById('roulette-decided-sub'),
        rouletteDecidedSpeed: document.getElementById('roulette-decided-speed'),
        rouletteDecidedPitches: document.getElementById('roulette-decided-pitches'),
        btnBattingSwingTouch: document.getElementById('btn-batting-swing-touch')
      };
    }

    addBattingTimer(fn, ms) {
      const tid = setTimeout(() => {
        this.bTimers = this.bTimers.filter(id => id !== tid);
        fn();
      }, ms);
      this.bTimers.push(tid);
      return tid;
    }

    clearBattingTimers() {
      for (const tid of this.bTimers) {
        clearTimeout(tid);
      }
      this.bTimers = [];
      this.clearRouletteAnimation();
    }

    clearRouletteAnimation() {
      if (this.rouletteAnimId) {
        cancelAnimationFrame(this.rouletteAnimId);
        this.rouletteAnimId = null;
      }
    }

    resizeBattingCanvas() {
      if (!this.dom.battingCanvas) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.bW = w;
      this.bH = h;
      this.dom.battingCanvas.width = w;
      this.dom.battingCanvas.height = h;
    }

    setBattingCameraMode(mode) {
      this.bCameraMode = mode;
      if (mode === 'BATTER') {
        if (this.dom.battingLayerBatter) this.dom.battingLayerBatter.classList.add('active');
        if (this.dom.battingLayerBroadcast) this.dom.battingLayerBroadcast.classList.remove('active');
        if (this.dom.battingBroadcastTicker) this.dom.battingBroadcastTicker.classList.remove('show');
        if (this.dom.battingMeterHud) this.dom.battingMeterHud.classList.remove('show');
      } else {
        if (this.dom.battingLayerBatter) this.dom.battingLayerBatter.classList.remove('active');
        if (this.dom.battingLayerBroadcast) this.dom.battingLayerBroadcast.classList.add('active');
      }
    }

    getBattingPitcherPos() {
      return { x: this.bW * 0.505, y: this.bH * 0.40 };
    }

    setBattingCursorPos(clientX, clientY) {
      if (!this.bBattingActive || this.bCameraMode !== 'BATTER' || !this.dom.battingCanvas) return;
      const rect = this.dom.battingCanvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const padX = this.bStrikeZone.w * 0.85;
      const padY = this.bStrikeZone.h * 0.85;
      this.bBatCursor.x = Math.max(this.bStrikeZone.x - padX, Math.min(this.bStrikeZone.x + padX, x));
      this.bBatCursor.y = Math.max(this.bStrikeZone.y - padY, Math.min(this.bStrikeZone.y + padY, y));
    }

    // --- ライバル投手の生成とプール ---
    buildPitcherProfile(raw, rankPos = 1) {
      const name = (raw && (raw.nickname || raw.name)) ? (raw.nickname || raw.name) : "ライバル投手";
      const solved = Number(raw ? (raw.totalSolved || raw.score || 0) : 0);
      const hr = Number(raw ? (raw.homeruns || 0) : 0);
      const maxDist = Number(raw ? (raw.maxDistance || 0) : 0);

      const powerPts = solved * 1.0 + hr * 2.2 + (maxDist > 100 ? (maxDist - 100) * 0.7 : 0);

      let grade = 'D';
      let maxSpeedKmh = 120;
      let pitches = ['STRAIGHT'];
      let pitchLabels = ['直球'];
      let control = 'CENTER';
      let controlLabel = '中央集球';
      let title = (raw && raw.title) ? raw.title : '期待の右腕';

      if (rankPos === 1) {
        grade = 'S';
        maxSpeedKmh = 163 + Math.floor(Math.random() * 5);
        pitches = ['FIREBALL', 'SLIDER', 'FORK'];
        pitchLabels = ['火の玉ストレート', '超鋭角スライダー', '消える魔球フォーク'];
        control = 'PINPOINT';
        controlLabel = '針の穴を通す制球';
        title = '全国1位・絶対的伝説の守護神';
      } else if (rankPos <= 3 || powerPts >= 160 || hr >= 50 || solved >= 75) {
        grade = 'S';
        maxSpeedKmh = 158 + Math.floor(Math.random() * 5);
        pitches = ['FIREBALL', 'SLIDER', 'FORK', 'STRAIGHT'];
        pitchLabels = ['火の玉', '鋭角スライダー', '消えるフォーク'];
        control = 'PINPOINT';
        controlLabel = '4隅ピンポイント';
        title = '全国トップクラスの豪腕エース';
      } else if (powerPts >= 90 || hr >= 30 || solved >= 45 || rankPos <= 6) {
        grade = 'A';
        maxSpeedKmh = 148 + Math.floor(Math.random() * 6);
        pitches = ['STRAIGHT', 'SLIDER', 'FORK'];
        pitchLabels = ['剛速球', '鋭角スライダー', '落差フォーク'];
        control = 'CORNER';
        controlLabel = 'きわどいコーナー攻め';
        title = '強豪校の看板エース';
      } else if (powerPts >= 45 || hr >= 18 || solved >= 25 || rankPos <= 12) {
        grade = 'B';
        maxSpeedKmh = 138 + Math.floor(Math.random() * 6);
        pitches = ['STRAIGHT', 'SLIDER', 'CURVE'];
        pitchLabels = ['直球', 'スライダー', 'ドロップカーブ'];
        control = 'CORNER';
        controlLabel = '外角コーナー狙い';
        title = '変幻自在の技巧派右腕';
      } else if (powerPts >= 20 || hr >= 8 || solved >= 12) {
        grade = 'C';
        maxSpeedKmh = 126 + Math.floor(Math.random() * 8);
        pitches = ['STRAIGHT', 'CURVE'];
        pitchLabels = ['直球', 'スローカーブ'];
        control = 'CENTER';
        controlLabel = 'ストライク先行';
        title = '緩急を操る好投手';
      } else {
        grade = 'D';
        maxSpeedKmh = 115 + Math.floor(Math.random() * 8);
        pitches = ['STRAIGHT'];
        pitchLabels = ['打ちやすい直球'];
        control = 'CENTER';
        controlLabel = 'ど真ん中勝負';
        title = '期待のルーキー投手';
      }

      const subTitle = rankPos > 0
        ? `名簿${rankPos}位 / ${solved > 0 ? solved + '問正解' : title}`
        : title;

      return {
        name,
        solved,
        homeruns: hr,
        maxDistance: maxDist,
        grade,
        maxSpeedKmh,
        pitches,
        pitchLabels,
        control,
        controlLabel,
        subTitle,
        rankPos
      };
    }

    getRivalCandidatesPool() {
      const uniqueMap = new Map();
      let users = [];
      try {
        users = this.getUsersCallback() || [];
      } catch (e) {
        users = [];
      }

      let rank = 1;
      // 名簿児童（解いた問題数の多い順）
      const sortedUsers = [...users].sort((a, b) => (Number(b.totalSolved) || 0) - (Number(a.totalSolved) || 0));

      for (const u of sortedUsers) {
        const name = (u.nickname || (u.className ? `${u.className} ${u.studentNumber}番` : '')).trim();
        if (!name || uniqueMap.has(name)) continue;
        const profile = this.buildPitcherProfile({
          name: name,
          totalSolved: u.totalSolved || 0
        }, rank);
        uniqueMap.set(name, profile);
        rank++;
        if (uniqueMap.size >= 15) break;
      }

      // デフォルトのライバル投手で補完
      for (const d of DEFAULT_RIVAL_PITCHERS) {
        if (!uniqueMap.has(d.name)) {
          const profile = this.buildPitcherProfile(d, rank);
          uniqueMap.set(d.name, profile);
          rank++;
        }
      }

      return Array.from(uniqueMap.values());
    }

    selectRivalPitcher() {
      const pool = this.getRivalCandidatesPool();
      return pool[Math.floor(Math.random() * pool.length)];
    }

    renderRouletteCard(cardEl, pitcher) {
      cardEl.className = 'roulette-card-item';
      const gradeChar = (pitcher.grade || 'D').toLowerCase().charAt(0);
      cardEl.innerHTML = `
        <span class="rival-rank-badge rank-${gradeChar}">${pitcher.grade || 'D'}</span>
        <div class="roulette-card-center">
          <span class="roulette-card-name">${escapeHtml(pitcher.name)} 投手</span>
          <span class="roulette-card-sub">${escapeHtml(pitcher.subTitle || '')}</span>
        </div>
        <div class="roulette-card-speed">${pitcher.maxSpeedKmh || 120} km/h</div>
      `;
    }

    updateBattingRivalCard(pitcher) {
      if (!pitcher || !this.dom.battingRivalCard) return;
      if (this.dom.battingRivalName) this.dom.battingRivalName.textContent = `${pitcher.name} 投手`;
      if (this.dom.battingRivalSub) this.dom.battingRivalSub.textContent = pitcher.subTitle;
      if (this.dom.battingRivalRankBadge) {
        this.dom.battingRivalRankBadge.textContent = pitcher.grade;
        this.dom.battingRivalRankBadge.className = `rival-rank-badge rank-${pitcher.grade.toLowerCase().charAt(0)}`;
      }
      if (this.dom.battingRivalSpeed) this.dom.battingRivalSpeed.textContent = `${pitcher.maxSpeedKmh} km/h`;
      if (this.dom.battingRivalPitches) this.dom.battingRivalPitches.textContent = pitcher.pitchLabels.join('・');
      if (this.dom.battingRivalControl) this.dom.battingRivalControl.textContent = pitcher.controlLabel;
      this.dom.battingRivalCard.classList.remove('hide-rival');
    }

    // --- ルーレット演出 ---
    startRivalRoulette(targetPitcher, onComplete) {
      this.clearRouletteAnimation();

      if (!this.dom.battingRouletteModal || !this.dom.rouletteReelStrip) {
        if (onComplete) onComplete(targetPitcher);
        return;
      }

      this.dom.rouletteReelStrip.innerHTML = '';
      this.dom.rouletteReelStrip.style.transform = 'translate3d(0, 0, 0)';

      const pool = this.getRivalCandidatesPool();
      const CARD_HEIGHT = 72;
      const TOTAL_CARDS = 38;
      const cardElements = [];

      const reelCards = [];
      while (reelCards.length < TOTAL_CARDS) {
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        reelCards.push(...shuffled);
      }

      for (let i = 0; i < TOTAL_CARDS; i++) {
        const cardEl = document.createElement('div');
        const randomPitcher = reelCards[i] || targetPitcher;
        this.renderRouletteCard(cardEl, randomPitcher);
        this.dom.rouletteReelStrip.appendChild(cardEl);
        cardElements.push(cardEl);
      }

      this.dom.battingRouletteModal.classList.remove('hide');
      if (this.dom.rouletteDecidedCard) {
        this.dom.rouletteDecidedCard.classList.remove('show');
        this.dom.rouletteDecidedCard.classList.add('hide');
      }
      if (this.dom.btnRouletteStop) {
        this.dom.btnRouletteStop.disabled = false;
        this.dom.btnRouletteStop.style.opacity = '1';
      }

      let roulettePos = 0;
      let rouletteState = 'SPINNING';
      let spinSpeed = 950;
      let lastTime = performance.now();
      let stopStartTime = 0;
      let stopStartPos = 0;
      const stopDuration = 1050;
      let winnerIndex = -1;
      let finalTargetY = 0;
      let lastTickIndex = -1;

      const triggerStop = () => {
        if (rouletteState !== 'SPINNING') return;
        rouletteState = 'STOPPING';
        stopStartTime = performance.now();
        stopStartPos = roulettePos;

        if (this.dom.btnRouletteStop) {
          this.dom.btnRouletteStop.disabled = true;
          this.dom.btnRouletteStop.style.opacity = '0.5';
        }

        const currentCardIdx = Math.floor(roulettePos / CARD_HEIGHT);
        winnerIndex = Math.min(TOTAL_CARDS - 3, Math.max(3, currentCardIdx + 5));

        if (cardElements[winnerIndex]) {
          this.renderRouletteCard(cardElements[winnerIndex], targetPitcher);
        }

        finalTargetY = (winnerIndex - 1) * CARD_HEIGHT;
      };

      const autoTimer = setTimeout(() => {
        if (rouletteState === 'SPINNING') {
          triggerStop();
        }
      }, 1500);

      const handleStopClick = (e) => {
        if (e) e.stopPropagation();
        triggerStop();
      };

      if (this.dom.btnRouletteStop) {
        this.dom.btnRouletteStop.onclick = handleStopClick;
      }
      this.dom.battingRouletteModal.onclick = () => {
        if (rouletteState === 'SPINNING') triggerStop();
      };

      const handleKeyDown = (e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
          if (rouletteState === 'SPINNING') triggerStop();
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      const cleanupListeners = () => {
        clearTimeout(autoTimer);
        window.removeEventListener('keydown', handleKeyDown);
        if (this.dom.btnRouletteStop) this.dom.btnRouletteStop.onclick = null;
        if (this.dom.battingRouletteModal) this.dom.battingRouletteModal.onclick = null;
      };

      const completeRoulette = () => {
        rouletteState = 'DECIDED';
        this.clearRouletteAnimation();
        cleanupListeners();

        if (cardElements[winnerIndex]) {
          cardElements[winnerIndex].classList.add('winner-highlight');
        }

        this.sound.playRouletteDecided();
        if (this.dom.battingImpactFlash) {
          this.dom.battingImpactFlash.classList.add('flash');
          setTimeout(() => {
            if (this.dom.battingImpactFlash) this.dom.battingImpactFlash.classList.remove('flash');
          }, 180);
        }

        if (this.dom.rouletteDecidedCard) {
          if (this.dom.rouletteDecidedRank) {
            this.dom.rouletteDecidedRank.textContent = targetPitcher.grade;
            this.dom.rouletteDecidedRank.className = `rival-rank-badge rank-${targetPitcher.grade.toLowerCase().charAt(0)}`;
          }
          if (this.dom.rouletteDecidedName) this.dom.rouletteDecidedName.textContent = `${targetPitcher.name} 投手`;
          if (this.dom.rouletteDecidedSub) this.dom.rouletteDecidedSub.textContent = targetPitcher.subTitle;
          if (this.dom.rouletteDecidedSpeed) this.dom.rouletteDecidedSpeed.textContent = `${targetPitcher.maxSpeedKmh} km/h`;
          if (this.dom.rouletteDecidedPitches) this.dom.rouletteDecidedPitches.textContent = targetPitcher.pitchLabels.join('・');

          this.dom.rouletteDecidedCard.classList.remove('hide');
          this.dom.rouletteDecidedCard.classList.add('show');
        }

        this.addBattingTimer(() => {
          if (this.dom.rouletteDecidedCard) {
            this.dom.rouletteDecidedCard.classList.remove('show');
            this.dom.rouletteDecidedCard.classList.add('hide');
          }
          if (this.dom.battingRouletteModal) {
            this.dom.battingRouletteModal.classList.add('hide');
          }

          this.sound.playPlayBall();

          if (onComplete) onComplete(targetPitcher);
        }, 950);
      };

      const animateRoulette = (now) => {
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (rouletteState === 'SPINNING') {
          roulettePos += spinSpeed * dt;
          const maxLoopY = (TOTAL_CARDS - 6) * CARD_HEIGHT;
          if (roulettePos >= maxLoopY) {
            roulettePos = 2 * CARD_HEIGHT;
          }
        } else if (rouletteState === 'STOPPING') {
          const elapsed = now - stopStartTime;
          const progress = Math.min(1.0, elapsed / stopDuration);
          const easeOut = 1 - Math.pow(1 - progress, 3.2);

          roulettePos = stopStartPos + (finalTargetY - stopStartPos) * easeOut;

          if (progress >= 1.0) {
            roulettePos = finalTargetY;
            this.dom.rouletteReelStrip.style.transform = `translate3d(0, -${roulettePos}px, 0)`;
            completeRoulette();
            return;
          }
        }

        this.dom.rouletteReelStrip.style.transform = `translate3d(0, -${roulettePos}px, 0)`;

        const curCardIdx = Math.floor((roulettePos + CARD_HEIGHT * 0.5) / CARD_HEIGHT);
        if (curCardIdx !== lastTickIndex && curCardIdx >= 0) {
          lastTickIndex = curCardIdx;
          this.sound.playRouletteTick();
        }

        this.rouletteAnimId = requestAnimationFrame(animateRoulette);
      };

      this.rouletteAnimId = requestAnimationFrame(animateRoulette);
    }

    // --- 変化球の物理軌道計算 ---
    calcPitchTrajectory(pitchType, safeProgress, breakDir = 1, grade = 'C') {
      let offsetX = 0;
      let offsetY = 0;
      const isS = (grade === 'S');
      const isTop = (grade === 'S' || grade === 'A');

      if (pitchType === 'CURVE') {
        const arc = Math.sin(safeProgress * Math.PI);
        const dropAmp = isTop ? 62 : 44;
        const breakAmp = isTop ? 38 : 26;
        offsetY = -arc * dropAmp;
        offsetX = -arc * breakDir * breakAmp;
      } else if (pitchType === 'SLIDER') {
        const breakStart = isTop ? 0.48 : 0.42;
        if (safeProgress > breakStart) {
          const breakFactor = Math.pow((safeProgress - breakStart) / (1.0 - breakStart), isTop ? 2.2 : 1.8);
          const breakAmp = isS ? 68 : (isTop ? 54 : 42);
          const dropAmp = isTop ? 14 : 8;
          offsetX = breakDir * breakFactor * breakAmp;
          offsetY = breakFactor * dropAmp;
        }
      } else if (pitchType === 'FORK') {
        const dropStart = isTop ? 0.50 : 0.48;
        if (safeProgress > dropStart) {
          const dropFactor = Math.pow((safeProgress - dropStart) / (1.0 - dropStart), isTop ? 2.4 : 2.0);
          const dropAmp = isS ? 84 : (isTop ? 64 : 46);
          offsetY = dropFactor * dropAmp;
        }
      } else if (pitchType === 'FIREBALL') {
        const riseStart = isTop ? 0.50 : 0.55;
        if (safeProgress > riseStart) {
          const riseFactor = Math.pow((safeProgress - riseStart) / (1.0 - riseStart), 1.8);
          const riseAmp = isS ? 28 : 18;
          offsetY = -riseFactor * riseAmp;
        }
      }

      return { offsetX, offsetY };
    }

    // --- メイン開始メソッド ---
    start(playerStats = {}) {
      this.clearBattingTimers();
      this.bBattingActive = true;
      this.setBattingCameraMode('BATTER');
      this.resizeBattingCanvas();

      if (this.dom.screenBatting) {
        this.dom.screenBatting.classList.remove('hide');
      }

      this.sound.playFever();

      if (this.dom.battingCanvas) {
        this.bCtx = this.dom.battingCanvas.getContext('2d');
      }

      const totalSolved = playerStats.totalSolved || 0;
      const curMeet = Math.min(99, Math.max(40, 40 + Math.floor(totalSolved * 0.4)));
      const curPower = Math.min(99, Math.max(40, 40 + Math.floor(totalSolved * 0.35)));

      const getGrade = (val) => val >= 90 ? 'S' : (val >= 80 ? 'A' : (val >= 70 ? 'B' : (val >= 60 ? 'C' : (val >= 50 ? 'D' : 'E'))));
      if (this.dom.battingPlayerStatsBadge) {
        this.dom.battingPlayerStatsBadge.textContent =
          `ミート: ${getGrade(curMeet)} ${curMeet} / パワー: ${getGrade(curPower)} ${curPower}`;
      }

      this.bBatCursor.radius = Math.min(52, Math.max(32, 32 + (curMeet - 40) * 0.35));
      this.bBatCursor.x = this.bStrikeZone.x;
      this.bBatCursor.y = this.bStrikeZone.y;
      this.bBatCursor.isSwinging = false;
      this.bBatCursor.swingProgress = 0;

      this.bParticles = [];
      this.bConfetti = [];
      this.bPitchTrail = [];
      this.bPitchState = 'READY';
      this.bBall.active = false;
      this.bBall.hit = false;
      this.bBall.swung = false;
      this.bBall.hitResult = null;
      this.bTrackingBall.active = false;

      this.currentRivalPitcher = this.selectRivalPitcher();

      if (this.dom.battingRivalCard) this.dom.battingRivalCard.classList.add('hide-rival');
      if (this.dom.battingPitchCallout) this.dom.battingPitchCallout.classList.remove('show');
      if (this.dom.battingHomerunPopup) this.dom.battingHomerunPopup.classList.remove('show');
      if (this.dom.battingStatusText) this.dom.battingStatusText.textContent = "対戦相手を抽選中...";

      if (this.bAnimId) cancelAnimationFrame(this.bAnimId);
      this.bAnimId = requestAnimationFrame((now) => this.renderBatting(now));

      // ルーレット開始
      this.startRivalRoulette(this.currentRivalPitcher, (decidedPitcher) => {
        if (!this.bBattingActive) return;

        this.updateBattingRivalCard(decidedPitcher);
        if (this.dom.battingStatusText) {
          this.dom.battingStatusText.textContent = `相手投手【${decidedPitcher.name}】が登板！【1球入魂】タイミングを合わせて打て！`;
        }

        // 安全装置（ウォッチドッグタイマー：8.5秒後に自動復帰）
        this.addBattingTimer(() => {
          if (this.bBattingActive) {
            console.warn("Batting watchdog timer triggered.");
            this.finishRewardBatting();
          }
        }, 8500);

        this.addBattingTimer(() => {
          if (this.bBattingActive) {
            this.throwRewardPitch();
          }
        }, 1000);
      });
    }

    throwRewardPitch() {
      if (!this.bBattingActive) return;
      this.bPitchState = 'WINDUP';
      this.bStateStartTime = performance.now();

      this.bBall.active = false;
      this.bBall.hit = false;
      this.bBall.swung = false;
      this.bBall.hitResult = null;
      this.bBatCursor.isSwinging = false;

      this.addBattingTimer(() => {
        if (!this.bBattingActive) return;
        this.releaseRewardPitch();
      }, 500);
    }

    releaseRewardPitch() {
      if (!this.bBattingActive) return;
      this.bBall.active = true;
      this.bBall.hit = false;
      this.bBall.swung = false;
      this.bBall.hitResult = null;
      this.bBall.startTime = performance.now();

      const rival = this.currentRivalPitcher || this.buildPitcherProfile(DEFAULT_RIVAL_PITCHERS[0], 1);
      const availablePitches = (rival && rival.pitches && rival.pitches.length > 0) ? rival.pitches : ['STRAIGHT'];
      const pitchType = availablePitches[Math.floor(Math.random() * availablePitches.length)];

      let speed = rival.maxSpeedKmh || 140;
      let pitchLabel = '直球';

      if (pitchType === 'FIREBALL') {
        speed += Math.floor(3 + Math.random() * 5);
        pitchLabel = '⚡ 火の玉ストレート';
      } else if (pitchType === 'SLIDER') {
        speed -= Math.floor(6 + Math.random() * 4);
        pitchLabel = '🌀 鋭角スライダー';
      } else if (pitchType === 'FORK') {
        speed -= Math.floor(10 + Math.random() * 5);
        pitchLabel = '📉 消える魔球フォーク';
      } else if (pitchType === 'CURVE') {
        speed -= Math.floor(32 + Math.random() * 8);
        pitchLabel = '🌈 大落差ドロップカーブ';
      } else {
        speed -= Math.floor(Math.random() * 3);
        pitchLabel = speed >= 152 ? '🔥 剛速球' : '⚾ ストレート';
      }

      this.bBall.speedKmh = Math.max(105, speed);
      const baseDuration = 880 - (this.bBall.speedKmh - 115) * 6.5;
      this.bBall.durationMs = Math.max(450, Math.floor(baseDuration));
      this.bBall.pitchType = pitchType;
      this.bBall.pitchLabel = pitchLabel;
      this.bBall.breakDir = Math.random() > 0.5 ? 1 : -1;

      const pPos = this.getBattingPitcherPos();
      this.bBall.x = pPos.x;
      this.bBall.y = pPos.y;

      const meatballChance = rival.grade === 'S' ? 0.05 : (rival.grade === 'A' ? 0.12 : (rival.grade === 'B' ? 0.22 : 0.40));
      const isMeatball = Math.random() < meatballChance;
      let cornerName = '真ん中';

      if (isMeatball) {
        this.bBall.isMeatball = true;
        this.bBall.targetX = this.bStrikeZone.x + (Math.random() - 0.5) * (this.bStrikeZone.w * 0.12);
        this.bBall.targetY = this.bStrikeZone.y + (Math.random() - 0.5) * (this.bStrikeZone.h * 0.12);
        cornerName = 'ド真ん中絶好球';
      } else if (rival.control === 'PINPOINT' || rival.control === 'CORNER') {
        const isPinpoint = rival.control === 'PINPOINT';
        const cornerIndex = Math.floor(Math.random() * 4);
        const padX = this.bStrikeZone.w * (isPinpoint ? 0.46 : 0.40);
        const padY = this.bStrikeZone.h * (isPinpoint ? 0.44 : 0.38);

        if (cornerIndex === 0) {
          this.bBall.targetX = this.bStrikeZone.x + padX;
          this.bBall.targetY = this.bStrikeZone.y + padY;
          cornerName = isPinpoint ? '外角低めいっぱい' : '外角低め';
        } else if (cornerIndex === 1) {
          this.bBall.targetX = this.bStrikeZone.x - padX;
          this.bBall.targetY = this.bStrikeZone.y - padY;
          cornerName = isPinpoint ? '内角高めズバッ' : '内角高め';
        } else if (cornerIndex === 2) {
          this.bBall.targetX = this.bStrikeZone.x - padX;
          this.bBall.targetY = this.bStrikeZone.y + padY;
          cornerName = isPinpoint ? '内角低めキワキワ' : '内角低め';
        } else {
          this.bBall.targetX = this.bStrikeZone.x + padX;
          this.bBall.targetY = this.bStrikeZone.y - padY;
          cornerName = isPinpoint ? '外角高めギリギリ' : '外角高め';
        }
        this.bBall.isMeatball = false;
      } else {
        this.bBall.targetX = this.bStrikeZone.x + (Math.random() - 0.5) * (this.bStrikeZone.w * 0.28);
        this.bBall.targetY = this.bStrikeZone.y + (Math.random() - 0.5) * (this.bStrikeZone.h * 0.28);
        cornerName = 'ストライク';
        this.bBall.isMeatball = false;
      }

      this.bBall.cornerName = cornerName;
      this.bPitchState = 'FLYING';
      this.sound.playRelease();

      const calloutText = isMeatball
        ? `🔥 失投だ！${cornerName}！`
        : `${pitchLabel} ${this.bBall.speedKmh}km/h (${cornerName})！`;

      if (this.dom.battingPitchCallout && this.dom.battingPitchCalloutType) {
        this.dom.battingPitchCalloutType.textContent = calloutText;
        this.dom.battingPitchCallout.classList.add('show');
        this.addBattingTimer(() => {
          if (this.dom.battingPitchCallout) this.dom.battingPitchCallout.classList.remove('show');
        }, 1200);
      }

      if (this.dom.battingStatusText) {
        this.dom.battingStatusText.textContent = `相手投手【${rival.name}】が投じた！${calloutText}`;
      }
    }

    executeBattingSwing() {
      if (this.bBatCursor.isSwinging || !this.bBattingActive) return;
      this.bBatCursor.isSwinging = true;
      this.bBatCursor.swingProgress = 0;
      this.sound.playWhoosh();

      if (!this.bBall.active || this.bBall.hit || this.bPitchState !== 'FLYING') {
        return;
      }

      const now = performance.now();
      const elapsed = Math.max(0, now - this.bBall.startTime);
      const timingDelta = elapsed - this.bBall.durationMs;

      const dist = Math.hypot(this.bBatCursor.x - this.bBall.x, this.bBatCursor.y - this.bBall.y);
      const cursorR = this.bBatCursor.radius;
      const coreR = 14;
      const absTiming = Math.abs(timingDelta);
      const rival = this.currentRivalPitcher;
      const rivalGrade = rival ? rival.grade : 'C';

      if (timingDelta < -300) {
        this.bBall.swung = true;
        if (this.dom.battingStatusText) {
          this.dom.battingStatusText.textContent = "💨 ちょっと早すぎた！ボールをよく見て打とう！";
        }
        return;
      }

      let maxPerfectTiming = 55;
      let maxPerfectDist = coreR;
      let maxHrTiming = 95;
      let maxHrDist = cursorR * 0.75;
      let maxHitTiming = 145;
      let maxHitDist = cursorR * 1.15;

      if (rivalGrade === 'S') {
        maxPerfectTiming = 38;
        maxPerfectDist = 11;
        maxHrTiming = 72;
        maxHrDist = cursorR * 0.60;
        maxHitTiming = 110;
        maxHitDist = cursorR * 0.90;
      } else if (rivalGrade === 'A') {
        maxPerfectTiming = 44;
        maxPerfectDist = 12;
        maxHrTiming = 80;
        maxHrDist = cursorR * 0.68;
        maxHitTiming = 125;
        maxHitDist = cursorR * 1.00;
      } else if (rivalGrade === 'D') {
        maxPerfectTiming = 65;
        maxPerfectDist = coreR * 1.25;
        maxHrTiming = 115;
        maxHrDist = cursorR * 0.88;
        maxHitTiming = 165;
        maxHitDist = cursorR * 1.25;
      }

      let result = '';
      let baseFlight = 0;

      if (absTiming <= maxPerfectTiming && dist <= maxPerfectDist) {
        result = 'PERFECT_HOMERUN';
        baseFlight = Math.floor(142 + Math.random() * 15);
      } else if (absTiming <= maxHrTiming && dist <= maxHrDist) {
        result = 'HOMERUN';
        baseFlight = Math.floor(125 + Math.random() * 14);
      } else if (absTiming <= maxHitTiming && dist <= maxHitDist) {
        result = 'HIT';
        baseFlight = Math.floor(75 + Math.random() * 30);
      } else if ((rivalGrade === 'S' || rivalGrade === 'A') && absTiming <= 140 && dist <= cursorR * 1.15) {
        result = 'WEAK_HIT';
        baseFlight = Math.floor(25 + Math.random() * 25);
      } else {
        result = 'SWING_AND_MISS';
      }

      const flight = (result === 'SWING_AND_MISS') ? 0 : baseFlight;

      this.bBall.swung = true;
      this.bBall.hitResult = result;

      if (result === 'PERFECT_HOMERUN' || result === 'HOMERUN') {
        this.bBall.hit = true;
        const flash = this.dom.battingImpactFlash;
        if (flash) {
          flash.classList.add('flash');
          this.addBattingTimer(() => flash.classList.remove('flash'), 50);
        }
        this.sound.playHomerun();
        this.startBattingBroadcastTracking(flight, true, result === 'PERFECT_HOMERUN', timingDelta, false);
      } else if (result === 'HIT') {
        this.bBall.hit = true;
        const flash = this.dom.battingImpactFlash;
        if (flash) {
          flash.classList.add('flash');
          this.addBattingTimer(() => flash.classList.remove('flash'), 50);
        }
        this.sound.playHit();
        this.startBattingBroadcastTracking(flight, false, false, timingDelta, false);
      } else if (result === 'WEAK_HIT') {
        this.bBall.hit = true;
        this.sound.playHit();
        if (this.dom.battingStatusText) {
          this.dom.battingStatusText.textContent = `💥 詰まった！【${rivalGrade}ランク投手の圧倒的球威】に押し負けた！`;
        }
        this.startBattingBroadcastTracking(flight, false, false, timingDelta, true);
      } else {
        if (this.dom.battingStatusText) {
          this.dom.battingStatusText.textContent = `💨 空振り！相手投手【${rival ? rival.name : '強敵'}】の${this.bBall.pitchLabel}にバットが空を切った！`;
        }
      }
    }

    startBattingBroadcastTracking(dist, isHr, isPerfect, timingDelta, isWeak = false) {
      this.bPitchState = 'RESULT';

      this.addBattingTimer(() => {
        if (!this.bBattingActive) return;
        this.setBattingCameraMode('BROADCAST');

        const ticker = this.dom.battingBroadcastTicker;
        const tickerText = this.dom.battingTickerText;
        const meterHud = this.dom.battingMeterHud;
        const meterVal = this.dom.battingMeterVal;

        const rivalName = this.currentRivalPitcher ? this.currentRivalPitcher.name : '相手投手';
        let dir = timingDelta < -10 ? 'レフトへ' : (timingDelta > 10 ? 'ライトへ' : 'バックスクリーンへ');
        if (isPerfect) {
          if (tickerText) tickerText.textContent = `全国屈指【${rivalName}】の魔球を一閃！完璧に捉えた大飛球が${dir}ぐんぐん伸びるー！！`;
        } else if (isHr) {
          if (tickerText) tickerText.textContent = `難敵【${rivalName}】を打ち砕いた！高々と上がった大飛球！${dir}スタンドへ一直線！！`;
        } else if (isWeak) {
          if (tickerText) tickerText.textContent = `打ち取られた！相手エース【${rivalName}】の圧倒的球威に差し込まれて力のない打球...`;
        } else {
          if (tickerText) tickerText.textContent = `強敵【${rivalName}】の球を捉えた！鋭い打球がグラウンドを抜けて${dir}クリーンヒット！！`;
        }

        if (ticker) ticker.classList.add('show');
        if (meterHud) meterHud.classList.add('show');
        if (meterVal) meterVal.textContent = '0m';

        this.bTrackingBall.active = true;
        this.bTrackingBall.startTime = performance.now();
        this.bTrackingBall.durationMs = isHr ? (isPerfect ? 2600 : 2300) : (isWeak ? 1400 : 1700);
        this.bTrackingBall.isHr = isHr;
        this.bTrackingBall.isPerfect = isPerfect;
        this.bTrackingBall.landed = false;
        this.bTrackingBall.targetDist = dist;
        this.bTrackingBall.trail = [];

        this.bTrackingBall.startX = this.bW * 0.5 + (this.bBatCursor.x - this.bStrikeZone.x) * 0.6;
        this.bTrackingBall.startY = this.bH * 0.88;

        const xOffset = (timingDelta < 0 ? -1 : 1) * Math.min(this.bW * 0.35, Math.abs(timingDelta) * 3);
        this.bTrackingBall.endX = this.bW * 0.5 + xOffset;
        this.bTrackingBall.endY = isHr ? (this.bH * 0.28 + (Math.random() - 0.5) * 40) : (isWeak ? (this.bH * 0.72) : (this.bH * 0.65));
        this.bTrackingBall.apexY = isHr ? (this.bH * 0.08) : (isWeak ? (this.bH * 0.55) : (this.bH * 0.45));

        const totalWait = this.bTrackingBall.durationMs + (isHr ? 2400 : 1400);
        this.addBattingTimer(() => {
          this.finishRewardBatting();
        }, totalWait);
      }, 120);
    }

    onBattingHomerunLanded() {
      this.bTrackingBall.landed = true;
      this.sound.playFirework();
      this.sound.playCheer();

      const viewport = document.querySelector('.app-viewport') || document.body;
      if (viewport) {
        viewport.classList.add('shake');
        this.addBattingTimer(() => viewport.classList.remove('shake'), 450);
      }

      const rivalName = this.currentRivalPitcher ? this.currentRivalPitcher.name : '相手投手';
      if (this.dom.battingTickerText) {
        this.dom.battingTickerText.textContent = this.bTrackingBall.isPerfect
          ? `スタンド最上段へ飛び込んだぁぁ！【${rivalName}】から特大ホームラン ${this.bTrackingBall.targetDist}m！！`
          : `スタンド中段へ飛び込んだー！【${rivalName}】からホームラン！推定 ${this.bTrackingBall.targetDist}m！！`;
      }

      this.spawnBattingFireworks(this.bTrackingBall.endX, this.bTrackingBall.endY);
      this.spawnBattingFireworks(this.bW * 0.25, this.bH * 0.22);
      this.spawnBattingFireworks(this.bW * 0.75, this.bH * 0.22);
      this.spawnBattingConfetti();

      if (this.dom.battingHrDistText) {
        this.dom.battingHrDistText.textContent = `推定飛距離 ${this.bTrackingBall.targetDist}m！`;
      }
      if (this.dom.battingHomerunPopup) {
        this.dom.battingHomerunPopup.classList.add('show');
        this.addBattingTimer(() => {
          if (this.dom.battingHomerunPopup) this.dom.battingHomerunPopup.classList.remove('show');
        }, 2600);
      }
    }

    spawnBattingFireworks(x, y) {
      const colors = ['#ffd23f', '#ff334b', '#00d2ff', '#00ffaa', '#ff88ff', '#ffffff'];
      for (let i = 0; i < 45; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 8;
        this.bParticles.push({
          x: x, y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 3 + Math.random() * 4,
          alpha: 1.0,
          decay: 0.015 + Math.random() * 0.02
        });
      }
    }

    spawnBattingConfetti() {
      const colors = ['#ffd23f', '#ff334b', '#00d2ff', '#00ffaa', '#e2e8f0', '#fb923c', '#c084fc'];
      for (let i = 0; i < 80; i++) {
        this.bConfetti.push({
          x: Math.random() * this.bW,
          y: -10 - Math.random() * 80,
          vx: (Math.random() - 0.5) * 2.5,
          vy: 2 + Math.random() * 4,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.15,
          sizeW: 8 + Math.random() * 6,
          sizeH: 5 + Math.random() * 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1.0
        });
      }
    }

    finishRewardBatting() {
      this.clearBattingTimers();
      this.clearRouletteAnimation();
      if (this.dom.battingRouletteModal) this.dom.battingRouletteModal.classList.add('hide');
      if (this.dom.rouletteDecidedCard) {
        this.dom.rouletteDecidedCard.classList.remove('show');
        this.dom.rouletteDecidedCard.classList.add('hide');
      }
      this.bBattingActive = false;
      this.bPitchTrail = [];
      if (this.bAnimId) {
        cancelAnimationFrame(this.bAnimId);
        this.bAnimId = null;
      }
      this.setBattingCameraMode('BATTER');
      if (this.dom.battingPitchCallout) this.dom.battingPitchCallout.classList.remove('show');
      if (this.dom.battingRivalCard) this.dom.battingRivalCard.classList.remove('hide-rival');

      if (this.dom.screenBatting) {
        this.dom.screenBatting.classList.add('hide');
      }

      if (typeof this.onCompleteCallback === 'function') {
        this.onCompleteCallback({
          result: this.bBall.hitResult,
          isHr: this.bTrackingBall.isHr,
          distance: this.bTrackingBall.targetDist
        });
      }
    }

    // --- 毎フレームCanvas描画ループ ---
    renderBatting(now) {
      if (!this.bBattingActive || !this.bCtx) return;

      try {
        if (this.bW <= 10 || this.bH <= 10) {
          this.resizeBattingCanvas();
        }
        this.bCtx.clearRect(0, 0, this.bW, this.bH);

        if (this.bCameraMode === 'BATTER') {
          this.drawBattingStrikeZone();
          this.drawBattingPitcherMotion(now);
          this.updateAndDrawPitchTrail();
          this.updateAndDrawBattingBall(now);
          this.drawBattingCursor();
          this.drawBattingSwingEffect();
        } else {
          this.updateAndDrawBattingTrackingBall(now);
          this.updateAndDrawBattingParticles();
          this.updateAndDrawBattingConfetti();
        }
      } catch (err) {
        console.error('Batting render error:', err);
      }

      this.bAnimId = requestAnimationFrame((t) => this.renderBatting(t));
    }

    drawBattingStrikeZone() {
      const zx = this.bStrikeZone.x - this.bStrikeZone.w / 2;
      const zy = this.bStrikeZone.y - this.bStrikeZone.h / 2;
      const zw = this.bStrikeZone.w;
      const zh = this.bStrikeZone.h;

      this.bCtx.save();
      this.bCtx.strokeStyle = 'rgba(0, 210, 255, 0.75)';
      this.bCtx.lineWidth = 2.5;
      this.bCtx.strokeRect(zx, zy, zw, zh);

      this.bCtx.fillStyle = 'rgba(0, 40, 90, 0.16)';
      this.bCtx.fillRect(zx, zy, zw, zh);

      this.bCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      this.bCtx.lineWidth = 1;
      this.bCtx.beginPath();
      this.bCtx.moveTo(zx + zw / 3, zy); this.bCtx.lineTo(zx + zw / 3, zy + zh);
      this.bCtx.moveTo(zx + (zw * 2) / 3, zy); this.bCtx.lineTo(zx + (zw * 2) / 3, zy + zh);
      this.bCtx.moveTo(zx, zy + zh / 3); this.bCtx.lineTo(zx + zw, zy + zh / 3);
      this.bCtx.moveTo(zx, zy + (zh * 2) / 3); this.bCtx.lineTo(zx + zw, zy + (zh * 2) / 3);
      this.bCtx.stroke();

      this.bCtx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      this.bCtx.beginPath();
      const bx = this.bStrikeZone.x;
      const by = zy + zh + 18;
      this.bCtx.moveTo(bx - 36, by);
      this.bCtx.lineTo(bx + 36, by);
      this.bCtx.lineTo(bx + 36, by + 12);
      this.bCtx.lineTo(bx, by + 26);
      this.bCtx.lineTo(bx - 36, by + 12);
      this.bCtx.closePath();
      this.bCtx.fill();
      this.bCtx.restore();
    }

    drawBattingPitcherMotion(now) {
      if (this.bPitchState !== 'WINDUP') return;
      const elapsed = Math.max(0, now - this.bStateStartTime);
      const progress = Math.min(1, elapsed / 500);

      const pPos = this.getBattingPitcherPos();
      this.bCtx.save();
      const r = (1 - progress) * 38 + 8;
      const rival = this.currentRivalPitcher;
      const isSRank = rival && rival.grade === 'S';
      const ringColor = isSRank ? 'rgba(255, 51, 75,' : 'rgba(255, 210, 63,';
      this.bCtx.strokeStyle = `${ringColor} ${0.4 + progress * 0.6})`;
      this.bCtx.lineWidth = isSRank ? 4.5 : 3;
      this.bCtx.beginPath();
      this.bCtx.arc(pPos.x, pPos.y, r, 0, Math.PI * 2);
      this.bCtx.stroke();

      this.bCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      this.bCtx.beginPath();
      this.bCtx.arc(pPos.x, pPos.y, 4.5, 0, Math.PI * 2);
      this.bCtx.fill();
      this.bCtx.restore();
    }

    updateAndDrawBattingBall(now) {
      if (!this.bBall.active || this.bBall.hit) return;

      const elapsed = Math.max(0, now - this.bBall.startTime);
      const progress = elapsed / Math.max(1, this.bBall.durationMs);

      if (progress >= 1.25) {
        this.bBall.active = false;
        this.sound.playCatch();
        if (this.dom.battingStatusText) {
          if (this.bBall.swung) {
            this.dom.battingStatusText.textContent = "💨 空振り！どんまい！次の5問でリベンジだ！";
          } else {
            this.dom.battingStatusText.textContent = "👀 見送り！次は振ってみよう！";
          }
        }
        this.addBattingTimer(() => {
          this.finishRewardBatting();
        }, 1600);
        return;
      }

      const pPos = this.getBattingPitcherPos();
      const safeProgress = Math.max(0, Math.min(1.25, progress));

      const traj = this.calcPitchTrajectory(
        this.bBall.pitchType,
        safeProgress,
        this.bBall.breakDir,
        this.currentRivalPitcher ? this.currentRivalPitcher.grade : 'C'
      );
      const baseX = pPos.x + (this.bBall.targetX - pPos.x) * safeProgress;
      const baseY = pPos.y + (this.bBall.targetY - pPos.y) * safeProgress;

      this.bBall.x = baseX + traj.offsetX;
      this.bBall.y = baseY + traj.offsetY;

      const r = Math.max(4, 4 + Math.pow(safeProgress, 2.2) * 26);

      // 魔球トレイル
      if (this.bBall.pitchType === 'FIREBALL' && Math.random() < 0.75) {
        this.bPitchTrail.push({
          x: this.bBall.x + (Math.random() - 0.5) * r * 0.7,
          y: this.bBall.y + (Math.random() - 0.5) * r * 0.7,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5 - 1.2,
          color: Math.random() < 0.5 ? '#ff334b' : '#ff9800',
          size: r * 0.55,
          alpha: 0.8,
          decay: 0.045
        });
      } else if (this.bBall.pitchType === 'CURVE' && Math.random() < 0.6) {
        this.bPitchTrail.push({
          x: this.bBall.x + (Math.random() - 0.5) * r * 0.4,
          y: this.bBall.y + (Math.random() - 0.5) * r * 0.4,
          vx: 0, vy: 0,
          color: '#00d2ff',
          size: r * 0.45,
          alpha: 0.6,
          decay: 0.04
        });
      } else if (this.bBall.pitchType === 'FORK' && Math.random() < 0.65) {
        this.bPitchTrail.push({
          x: this.bBall.x + (Math.random() - 0.5) * r * 0.4,
          y: this.bBall.y + (Math.random() - 0.5) * r * 0.4,
          vx: 0, vy: 1.6,
          color: '#a855f7',
          size: r * 0.5,
          alpha: 0.7,
          decay: 0.05
        });
      } else if (this.bBall.pitchType === 'SLIDER' && Math.random() < 0.6) {
        this.bPitchTrail.push({
          x: this.bBall.x + (Math.random() - 0.5) * r * 0.4,
          y: this.bBall.y + (Math.random() - 0.5) * r * 0.4,
          vx: this.bBall.breakDir * 1.2, vy: 0.4,
          color: '#22c55e',
          size: r * 0.45,
          alpha: 0.65,
          decay: 0.045
        });
      }

      this.bCtx.save();
      if (this.bBall.pitchType === 'FIREBALL') {
        this.bCtx.shadowColor = '#ff334b';
        this.bCtx.shadowBlur = 18;
      } else if (this.bBall.pitchType === 'FORK') {
        this.bCtx.shadowColor = '#a855f7';
        this.bCtx.shadowBlur = 14;
      } else if (this.bBall.pitchType === 'CURVE') {
        this.bCtx.shadowColor = '#00d2ff';
        this.bCtx.shadowBlur = 12;
      } else if (this.bBall.pitchType === 'SLIDER') {
        this.bCtx.shadowColor = '#22c55e';
        this.bCtx.shadowBlur = 12;
      }

      this.bCtx.fillStyle = '#ffffff';
      this.bCtx.beginPath();
      this.bCtx.arc(this.bBall.x, this.bBall.y, r, 0, Math.PI * 2);
      this.bCtx.fill();

      if (r > 7) {
        this.bCtx.strokeStyle = this.bBall.pitchType === 'FIREBALL' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(239, 68, 68, 0.6)';
        this.bCtx.lineWidth = Math.max(1, r * 0.1);
        this.bCtx.beginPath();
        this.bCtx.arc(this.bBall.x - r * 0.2, this.bBall.y, r * 0.7, -0.6, 0.6);
        this.bCtx.stroke();
      }
      this.bCtx.restore();
    }

    updateAndDrawPitchTrail() {
      for (let i = this.bPitchTrail.length - 1; i >= 0; i--) {
        const p = this.bPitchTrail[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
          this.bPitchTrail.splice(i, 1);
          continue;
        }
        this.bCtx.save();
        this.bCtx.globalAlpha = Math.max(0, p.alpha);
        this.bCtx.fillStyle = p.color;
        this.bCtx.shadowColor = p.color;
        this.bCtx.shadowBlur = 8;
        this.bCtx.beginPath();
        this.bCtx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
        this.bCtx.fill();
        this.bCtx.restore();
      }
    }

    drawBattingCursor() {
      this.bCtx.save();
      const cx = this.bBatCursor.x;
      const cy = this.bBatCursor.y;
      const r = this.bBatCursor.radius;

      this.bCtx.strokeStyle = 'rgba(255, 210, 63, 0.85)';
      this.bCtx.lineWidth = 2.5;
      this.bCtx.fillStyle = 'rgba(255, 210, 63, 0.18)';
      this.bCtx.beginPath();
      this.bCtx.arc(cx, cy, r, 0, Math.PI * 2);
      this.bCtx.fill();
      this.bCtx.stroke();

      this.bCtx.strokeStyle = '#ff334b';
      this.bCtx.fillStyle = 'rgba(255, 51, 75, 0.5)';
      this.bCtx.lineWidth = 2;
      this.bCtx.beginPath();
      this.bCtx.arc(cx, cy, 10, 0, Math.PI * 2);
      this.bCtx.fill();
      this.bCtx.stroke();

      this.bCtx.strokeStyle = 'rgba(255, 210, 63, 0.6)';
      this.bCtx.lineWidth = 1.5;
      this.bCtx.beginPath();
      this.bCtx.moveTo(cx - r - 6, cy); this.bCtx.lineTo(cx + r + 6, cy);
      this.bCtx.moveTo(cx, cy - r - 6); this.bCtx.lineTo(cx + r + 6, cy);
      this.bCtx.stroke();
      this.bCtx.restore();
    }

    drawBattingSwingEffect() {
      if (!this.bBatCursor.isSwinging) return;
      this.bBatCursor.swingProgress += 0.12;

      this.bCtx.save();
      const prog = this.bBatCursor.swingProgress;
      const alpha = Math.max(0, 1 - prog);
      this.bCtx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
      this.bCtx.lineWidth = 8 * (1 - prog * 0.5);
      this.bCtx.beginPath();
      this.bCtx.arc(this.bBatCursor.x, this.bBatCursor.y + 10, this.bBatCursor.radius * 1.6, -0.8 + prog * 1.5, 0.8 + prog * 1.5);
      this.bCtx.stroke();
      this.bCtx.restore();

      if (this.bBatCursor.swingProgress >= 1) {
        this.bBatCursor.isSwinging = false;
      }
    }

    updateAndDrawBattingTrackingBall(now) {
      if (!this.bTrackingBall.active) return;

      const elapsed = now - this.bTrackingBall.startTime;
      const progress = Math.min(1.0, elapsed / this.bTrackingBall.durationMs);

      const curDist = Math.floor(progress * this.bTrackingBall.targetDist);
      if (this.dom.battingMeterVal) this.dom.battingMeterVal.textContent = `${curDist}m`;

      const curX = this.bTrackingBall.startX + (this.bTrackingBall.endX - this.bTrackingBall.startX) * progress;

      const p0Y = this.bTrackingBall.startY;
      const p1Y = this.bTrackingBall.apexY;
      const p2Y = this.bTrackingBall.endY;
      const curY = Math.pow(1 - progress, 2) * p0Y + 2 * (1 - progress) * progress * p1Y + Math.pow(progress, 2) * p2Y;

      this.bTrackingBall.currentX = curX;
      this.bTrackingBall.currentY = curY;

      const curScale = (1.0 - progress * 0.82);
      this.bTrackingBall.currentScale = curScale;

      const camOffsetY = Math.sin(progress * Math.PI) * -35;
      if (this.dom.battingImgBroadcast) {
        this.dom.battingImgBroadcast.style.transform = `scale(1.06) translateY(${camOffsetY}px)`;
      }

      this.bTrackingBall.trail.push({ x: curX, y: curY, scale: curScale, alpha: 1.0 });
      if (this.bTrackingBall.trail.length > 25) this.bTrackingBall.trail.shift();

      this.bCtx.save();
      for (let i = 0; i < this.bTrackingBall.trail.length; i++) {
        const pt = this.bTrackingBall.trail[i];
        const trailAlpha = (i / this.bTrackingBall.trail.length) * 0.6;
        const trailR = Math.max(1.5, 20 * pt.scale * (i / this.bTrackingBall.trail.length));

        this.bCtx.fillStyle = this.bTrackingBall.isHr ? `rgba(255, 210, 63, ${trailAlpha})` : `rgba(0, 210, 255, ${trailAlpha})`;
        this.bCtx.shadowColor = this.bTrackingBall.isHr ? '#ff334b' : '#00ffaa';
        this.bCtx.shadowBlur = 10;
        this.bCtx.beginPath();
        this.bCtx.arc(pt.x, pt.y, trailR, 0, Math.PI * 2);
        this.bCtx.fill();
      }
      this.bCtx.restore();

      const ballR = Math.max(2.5, 22 * curScale);
      this.bCtx.save();
      this.bCtx.fillStyle = '#ffffff';
      this.bCtx.shadowColor = this.bTrackingBall.isHr ? '#ffd23f' : '#00d2ff';
      this.bCtx.shadowBlur = 24;
      this.bCtx.beginPath();
      this.bCtx.arc(curX, curY, ballR, 0, Math.PI * 2);
      this.bCtx.fill();

      this.bCtx.fillStyle = '#fff';
      this.bCtx.beginPath();
      this.bCtx.arc(curX, curY, ballR * 0.6, 0, Math.PI * 2);
      this.bCtx.fill();
      this.bCtx.restore();

      if (progress >= 1.0 && !this.bTrackingBall.landed) {
        if (this.bTrackingBall.isHr) {
          this.onBattingHomerunLanded();
        } else {
          this.bTrackingBall.landed = true;
          this.sound.playCatch();
        }
      }
    }

    updateAndDrawBattingParticles() {
      for (let i = this.bParticles.length - 1; i >= 0; i--) {
        const p = this.bParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
          this.bParticles.splice(i, 1);
          continue;
        }
        this.bCtx.save();
        this.bCtx.globalAlpha = Math.max(0, p.alpha);
        this.bCtx.fillStyle = p.color;
        this.bCtx.shadowColor = p.color;
        this.bCtx.shadowBlur = 6;
        this.bCtx.beginPath();
        this.bCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.bCtx.fill();
        this.bCtx.restore();
      }
    }

    updateAndDrawBattingConfetti() {
      for (let i = this.bConfetti.length - 1; i >= 0; i--) {
        const c = this.bConfetti[i];
        c.x += c.vx + Math.sin(c.y * 0.02) * 1.5;
        c.y += c.vy;
        c.rot += c.rotSpeed;
        if (c.y > this.bH + 50) {
          this.bConfetti.splice(i, 1);
          continue;
        }
        this.bCtx.save();
        this.bCtx.translate(c.x, c.y);
        this.bCtx.rotate(c.rot);
        this.bCtx.fillStyle = c.color;
        this.bCtx.fillRect(-c.sizeW / 2, -c.sizeH / 2, c.sizeW, c.sizeH);
        this.bCtx.restore();
      }
    }

    // --- イベントバインド ---
    bindEvents() {
      if (typeof window === 'undefined') return;

      window.addEventListener('resize', () => {
        if (this.bBattingActive) {
          this.resizeBattingCanvas();
        }
      });

      if (this.dom.battingCanvas) {
        this.dom.battingCanvas.addEventListener('mousemove', (e) => {
          this.setBattingCursorPos(e.clientX, e.clientY);
        });

        this.dom.battingCanvas.addEventListener('touchmove', (e) => {
          if (e.touches.length > 0) {
            this.setBattingCursorPos(e.touches[0].clientX, e.touches[0].clientY);
          }
          e.preventDefault();
        }, { passive: false });

        this.dom.battingCanvas.addEventListener('touchstart', (e) => {
          if (e.touches.length > 0) {
            this.setBattingCursorPos(e.touches[0].clientX, e.touches[0].clientY);
          }
          if (this.bBattingActive && this.bCameraMode === 'BATTER') {
            this.executeBattingSwing();
          }
          e.preventDefault();
        }, { passive: false });

        this.dom.battingCanvas.addEventListener('mousedown', (e) => {
          if (e.button === 0 && this.bBattingActive && this.bCameraMode === 'BATTER') {
            this.executeBattingSwing();
          }
        });
      }

      if (this.dom.btnBattingSwingTouch) {
        this.dom.btnBattingSwingTouch.addEventListener('touchstart', (e) => {
          e.preventDefault();
          if (this.bBattingActive && this.bCameraMode === 'BATTER') {
            this.executeBattingSwing();
          }
        });

        this.dom.btnBattingSwingTouch.addEventListener('click', (e) => {
          e.currentTarget.blur();
          if (this.bBattingActive && this.bCameraMode === 'BATTER') {
            this.executeBattingSwing();
          }
        });
      }

      window.addEventListener('keydown', (e) => {
        if ((e.code === 'Space' || e.code === 'Enter') && this.bBattingActive && this.bCameraMode === 'BATTER') {
          e.preventDefault();
          this.executeBattingSwing();
        }
      });
    }
  }

  return BattingGameManager;
});
