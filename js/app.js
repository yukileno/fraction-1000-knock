// 熱血！分数1000本ノック アプリケーション制御
(function() {
  'use strict';

  const { generateProblem, checkAnswer } = window.FractionEngine;
  const StudyTracker = window.StudyTracker;
  const SheetSync = window.SheetSync;
  const AuthManager = window.AuthManager;

  // 熱血効果音プレイヤー (オーディオファイル ＆ Web Audio API)
  class SoundPlayer {
    constructor() {
      this.hitAudio = null;
      this.homerunAudio = null;
      this.initAudios();
    }

    initAudios() {
      // 1. HTML埋め込みの audio タグがあればそれを取得
      const elHit = document.getElementById('audioHit');
      const elHomerun = document.getElementById('audioHomerun');
      if (elHit) this.hitAudio = elHit;
      if (elHomerun) this.homerunAudio = elHomerun;

      // 2. なければ sound/ ディレクトリから直に生成
      if (!this.hitAudio) {
        try {
          this.hitAudio = new Audio('sound/hit.mp3');
        } catch (e) {}
      }
      if (!this.homerunAudio) {
        try {
          this.homerunAudio = new Audio('sound/homerun.mp3');
        } catch (e) {}
      }
    }

    playHit() {
      try {
        if (this.hitAudio) {
          this.hitAudio.currentTime = 0;
          const p = this.hitAudio.play();
          if (p && p.catch) p.catch(() => this.playSynthHit());
        } else {
          this.playSynthHit();
        }
      } catch (e) {
        this.playSynthHit();
      }
    }

    playHomerun() {
      try {
        if (this.homerunAudio) {
          this.homerunAudio.currentTime = 0;
          const p = this.homerunAudio.play();
          if (p && p.catch) p.catch(() => this.playHit());
        } else {
          this.playHit();
        }
      } catch (e) {
        this.playHit();
      }
    }

    // 空振りの豪快スイング音（風切り音「ブンッ！」＋ミット捕球「バシッ！」）
    playSwingMiss() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const bufferSize = Math.floor(ctx.sampleRate * 0.22);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(450, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(1300, ctx.currentTime + 0.08);
        filter.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.22);
        filter.Q.value = 3;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.45, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start();

        // 0.2秒後にミット捕球音
        setTimeout(() => {
          try {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(140, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.07);
            g.gain.setValueAtTime(0.35, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.07);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.07);
          } catch (e) {}
        }, 190);
      } catch (e) {
        this.playWrong();
      }
    }

    // 音声ファイル未読込時のシンセサイザー代替音
    playSynthHit() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch (e) {}
    }

    playWrong() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.setValueAtTime(160, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch (e) {}
    }
  }

  // ⚾ ピッチャー vs バッター対決ステージ演出マネージャー
  class BaseballShowdown {
    constructor(soundPlayer) {
      this.sound = soundPlayer;
      this.pitcherEl = document.getElementById('spritePitcher');
      this.batterEl = document.getElementById('spriteBatter');
      this.fireballEl = document.getElementById('fireballBall');
      this.umpireEl = document.getElementById('umpireCall');
      this.batterNameTag = document.getElementById('batterNameTag');
      this.pitcherNameTag = document.getElementById('pitcherNameTag');

      this.pitchTimer = null;
      this.swingTimer = null;
      this.umpireTimer = null;
      this.isWaitingForAnswer = false;
    }

    setBatterName(name) {
      if (this.batterNameTag && name) {
        this.batterNameTag.textContent = `${name}（私）`;
      }
    }

    setPitcherName(name) {
      if (this.pitcherNameTag && name) {
        this.pitcherNameTag.textContent = `${name} 投手`;
      }
    }

    // 投球モーション開始（新問出題時）
    pitch() {
      if (!this.pitcherEl || !this.batterEl || !this.fireballEl) return;

      // 前回のタイマーをクリア
      clearTimeout(this.pitchTimer);
      clearTimeout(this.swingTimer);
      clearTimeout(this.umpireTimer);

      // バッターは構え
      this.setBatterMotion('stance');
      this.hideUmpireCall();

      // ピッチャー投球モーション
      // 1. セットポジション
      this.setPitcherMotion('set');
      this.fireballEl.className = 'fireball-container hidden';

      // 2. 足上げ（ワインドアップ）
      setTimeout(() => {
        this.setPitcherMotion('windup');
      }, 120);

      // 3. 踏み込み
      setTimeout(() => {
        this.setPitcherMotion('stride');
      }, 250);

      // 4. リリース（腕を振って火の玉発射！）
      setTimeout(() => {
        this.setPitcherMotion('release');
        this.fireballEl.className = 'fireball-container pitching';
      }, 380);

      // 5. フォロースルー
      setTimeout(() => {
        this.setPitcherMotion('follow');
      }, 500);

      // 6. ボールがバッター手前へ到着 → ブルブル激震待機へ！
      setTimeout(() => {
        this.fireballEl.className = 'fireball-container waiting';
        this.isWaitingForAnswer = true;
      }, 800);
    }

    // 正解時：フルスイング快打！
    swingHit(isHomerun = false) {
      if (!this.batterEl || !this.fireballEl) return;
      this.isWaitingForAnswer = false;
      clearTimeout(this.swingTimer);

      // バッター：テイクバック（タメ）
      this.setBatterMotion('takeback');

      // インパクト
      this.swingTimer = setTimeout(() => {
        this.setBatterMotion('impact');

        // ボールがカキーンと右上へ飛ぶ！
        this.fireballEl.className = isHomerun ? 'fireball-container homerun-fly' : 'fireball-container hit-fly';

        // 審判コール
        this.showUmpireCall(isHomerun ? 'HOMERUN!!' : 'HIT!!', isHomerun ? 'call-homerun' : 'call-hit');

        // フォロースルー
        setTimeout(() => {
          this.setBatterMotion('follow');
        }, 120);
      }, 80);
    }

    // 不正解時：豪快に空振り三振！
    swingMiss() {
      if (!this.batterEl || !this.fireballEl) return;
      this.isWaitingForAnswer = false;
      clearTimeout(this.swingTimer);

      // 空振り音を再生
      if (this.sound && typeof this.sound.playSwingMiss === 'function') {
        this.sound.playSwingMiss();
      }

      // バッター：始動
      this.setBatterMotion('takeback');

      // スイング＆空振り
      this.swingTimer = setTimeout(() => {
        this.setBatterMotion('impact');
        // ボールが捕手ミットへ抜ける
        this.fireballEl.className = 'fireball-container miss-pass';

        setTimeout(() => {
          // 豪快に体勢を崩して空振り！
          this.setBatterMotion('miss');
          this.showUmpireCall('STRIKE!!', 'call-strike');

          // 少しして再び構えに戻り、ボールもバッター前で唸り直す
          setTimeout(() => {
            this.setBatterMotion('stance');
            this.fireballEl.className = 'fireball-container waiting';
            this.hideUmpireCall();
            this.isWaitingForAnswer = true;
          }, 900);
        }, 90);
      }, 70);
    }

    setPitcherMotion(motion) {
      if (!this.pitcherEl) return;
      this.pitcherEl.className = `sprite-pitcher ${motion}`;
    }

    setBatterMotion(motion) {
      if (!this.batterEl) return;
      this.batterEl.className = `sprite-batter ${motion}`;
    }

    showUmpireCall(text, className) {
      if (!this.umpireEl) return;
      clearTimeout(this.umpireTimer);
      this.umpireEl.textContent = text;
      this.umpireEl.className = `umpire-call show ${className}`;
      this.umpireTimer = setTimeout(() => {
        this.hideUmpireCall();
      }, 1400);
    }

    hideUmpireCall() {
      if (!this.umpireEl) return;
      this.umpireEl.classList.remove('show');
    }
  }

  class App {
    constructor() {
      this.sound = new SoundPlayer();
      this.auth = new AuthManager();
      this.problemMode = 'mix'; // ミックス固定
      this.currentProblem = null;
      this.activeInputBox = null;
      this.comboCount = 0; // 連続ヒット数
      this.pitchCount = 1; // 本日の投球数

      this.selectedClass = '5年1組';
      this.selectedNumber = 1;

      // 野球対決ステージ（ピッチャー vs バッター）マネージャー
      this.showdown = new BaseballShowdown(this.sound);

      this.initElements();
      this.populateNumberSelect();

      // トラッカー初期化（1000本ノック仕様）
      this.tracker = new StudyTracker({
        targetKnocks: 1000,
        onTick: (data) => this.updateTimerDisplay(data),
        onIdleStateChange: (isIdle) => this.handleIdleChange(isIdle)
      });

      // スプレッドシート同期マネージャー
      this.sync = new SheetSync({
        onStatusChange: (status) => this.updateSyncButton(status)
      });

      this.initCoachImage();
      this.initScratchCanvas();
      this.bindEvents();

      // 毎回入部届（ログイン）を求める（URLに?test_userがあれば自動スキップ）
      const urlParams = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;
      if (urlParams && urlParams.get('test_user')) {
        const dummyUser = { className: '5年1組', studentNumber: 1, nickname: 'テスト打者' };
        this.onLoginComplete(dummyUser, false);
      } else {
        this.showAuthModal();
      }

      // バックグラウンドでスプレッドシート名簿を先読み
      this.loadRemoteUsers();

      // 初期保存ボタン表示
      this.sync.checkAndNotify();
    }

    initElements() {
      this.appViewport = document.getElementById('appViewport');
      this.hitEffectOverlay = document.getElementById('hitEffectOverlay');
      this.hitEffectText = document.getElementById('hitEffectText');

      // スコアボード
      this.knockRemainingDisplay = document.getElementById('knockRemainingDisplay');
      this.knockStatusLabel = document.getElementById('knockStatusLabel');
      this.knockUnit = document.getElementById('knockUnit');
      this.knockProgress = document.getElementById('knockProgress');
      this.knockSubText = document.getElementById('knockSubText');

      this.studentDisplayName = document.getElementById('studentDisplayName');
      this.pitchNumberBadge = document.getElementById('pitchNumberBadge');
      this.categoryBadge = document.getElementById('categoryBadge');
      this.probTimerBadge = document.getElementById('probTimerBadge');
      this.formulaEl = document.getElementById('formulaDisplay');

      // 入力ボックス
      this.inputWhole = document.getElementById('inputWhole');
      this.inputNum = document.getElementById('inputNum');
      this.inputDen = document.getElementById('inputDen');
      this.activeInputBox = this.inputWhole;

      // 特訓テンキー要素
      this.slotTabWhole = document.getElementById('slotTabWhole');
      this.slotTabNum = document.getElementById('slotTabNum');
      this.slotTabDen = document.getElementById('slotTabDen');
      this.btnNumpadBs = document.getElementById('btnNumpadBs');
      this.btnNumpadAc = document.getElementById('btnNumpadAc');
      this.btnNumpadNextSlot = document.getElementById('btnNumpadNextSlot');
      this.numpadBtns = document.querySelectorAll('.numpad-btn[data-num]');

      // ボタン
      this.btnCheck = document.getElementById('btnCheck');
      this.feedbackBox = document.getElementById('feedbackBox');

      // 鬼監督
      this.coachImg = document.getElementById('coachImg');
      this.coachBubble = document.getElementById('coachBubble');

      // ダッシュボード
      this.statTodaySolved = document.getElementById('statTodaySolved');
      this.statTodayTime = document.getElementById('statTodayTime');
      this.statSessionBadge = document.getElementById('statSessionBadge');

      this.statTodayAcc = document.getElementById('statTodayAcc');
      this.statPastAcc = document.getElementById('statPastAcc');
      this.statAccBadge = document.getElementById('statAccBadge');

      this.statTodaySpeed = document.getElementById('statTodaySpeed');
      this.statPastSpeed = document.getElementById('statPastSpeed');
      this.statSpeedBadge = document.getElementById('statSpeedBadge');

      this.statAllSolved = document.getElementById('statAllSolved');
      this.statAllTime = document.getElementById('statAllTime');
      this.statComboBadge = document.getElementById('statComboBadge');

      // 保存ボタン
      this.btnSync = document.getElementById('btnSync');
      this.btnSyncText = document.getElementById('btnSyncText');

      // 認証モーダル要素
      this.authModal = document.getElementById('authModal');
      this.authStepSelect = document.getElementById('authStepSelect');
      this.authStepConfirm = document.getElementById('authStepConfirm');
      this.authStepRegister = document.getElementById('authStepRegister');

      this.authClass = document.getElementById('authClass');
      this.authNumber = document.getElementById('authNumber');
      this.btnStepNext = document.getElementById('btnStepNext');

      this.confirmClassNum = document.getElementById('confirmClassNum');
      this.confirmNickname = document.getElementById('confirmNickname');
      this.btnStartConfirmed = document.getElementById('btnStartConfirmed');
      this.btnEditNickname = document.getElementById('btnEditNickname');

      this.registerClassNum = document.getElementById('registerClassNum');
      this.inputNickname = document.getElementById('inputNickname');
      this.btnSaveNickname = document.getElementById('btnSaveNickname');
      this.btnBackToSelect = document.getElementById('btnBackToSelect');

      // 完走・放置・記録モーダル
      this.goalModal = document.getElementById('goalModal');
      this.btnContinueExtra = document.getElementById('btnContinueExtra');
      this.idleModal = document.getElementById('idleModal');
      this.btnResume = document.getElementById('btnResume');
      this.logModal = document.getElementById('logModal');
      this.btnShowLogs = document.getElementById('btnShowLogs');
      this.btnCloseLogs = document.getElementById('btnCloseLogs');
      this.btnCloseLogsBottom = document.getElementById('btnCloseLogsBottom');
      this.logTableBody = document.getElementById('logTableBody');

      // 🏆 ランキングモーダル要素
      this.rankingModal = document.getElementById('rankingModal');
      this.btnShowRanking = document.getElementById('btnShowRanking');
      this.btnOpenRankingFromAuth = document.getElementById('btnOpenRankingFromAuth');
      this.btnOpenRankingFromAuth2 = document.getElementById('btnOpenRankingFromAuth2');
      this.btnOpenRankingFromGoal = document.getElementById('btnOpenRankingFromGoal');
      this.btnCloseRanking = document.getElementById('btnCloseRanking');
      this.btnCloseRankingBottom = document.getElementById('btnCloseRankingBottom');
      this.rankingClassFilter = document.getElementById('rankingClassFilter');
      this.btnRefreshRanking = document.getElementById('btnRefreshRanking');
      this.btnRefreshRankingText = document.getElementById('btnRefreshRankingText');
      this.rankingTableBody = document.getElementById('rankingTableBody');
      this.rankingEmptyMsg = document.getElementById('rankingEmptyMsg');
      this.myRankBanner = document.getElementById('myRankBanner');
      this.myRankBadge = document.getElementById('myRankBadge');
      this.myRankName = document.getElementById('myRankName');
      this.myRankStat = document.getElementById('myRankStat');
      this.rankingFromAuth = false;
    }

    initCoachImage() {
      const bgUrl = (window.ASSETS && window.ASSETS.KYOJIN_IMG)
        ? `url("${window.ASSETS.KYOJIN_IMG}")`
        : 'url("kyojin.jpg")';
      document.body.style.backgroundImage = bgUrl;
      if (this.appViewport) {
        this.appViewport.style.backgroundImage = bgUrl;
      }
    }

    populateNumberSelect() {
      this.authNumber.innerHTML = '';
      for (let i = 1; i <= 45; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `背番号 ${i} 番`;
        this.authNumber.appendChild(opt);
      }
    }

    async loadRemoteUsers() {
      try {
        const users = await this.sync.fetchUsersFromSheet(12000);
        if (users && users.length > 0) {
          this.auth.syncWithRemoteUsers(users);
        }
      } catch (e) {
        console.warn('Could not pre-fetch users:', e);
      }
    }

    updateSyncButton(info) {
      this.btnSync.className = 'btn-sync';
      if (info.state === 'saving') {
        this.btnSync.classList.add('status-saving');
        this.btnSync.disabled = true;
        this.btnSyncText.textContent = `⏳ 保存中...`;
      } else if (info.state === 'unsaved' || info.count > 0) {
        this.btnSync.classList.add('status-unsaved');
        this.btnSync.disabled = false;
        this.btnSyncText.textContent = `☁️ 今すぐ保存 (${info.count})`;
      } else {
        this.btnSync.classList.add('status-saved');
        this.btnSync.disabled = true;
        this.btnSyncText.textContent = `✅ 保存済み`;
      }
    }

    showAuthModal() {
      this.authModal.classList.add('active');
      this.authStepSelect.style.display = 'block';
      this.authStepConfirm.style.display = 'none';
      this.authStepRegister.style.display = 'none';
    }

    hideAuthModal() {
      this.authModal.classList.remove('active');
    }

    onLoginComplete(user, isNew = false) {
      this.hideAuthModal();
      this.studentDisplayName.textContent = `⚾ 背番号${user.studentNumber}番 ${user.nickname} 選手`;
      this.tracker.setCurrentUser(user);
      this.showdown.setBatterName(user.nickname);
      this.updateGrowthDashboard();
      this.nextProblem();
      this.tracker.start();

      this.setCoachSpeech(`「${user.nickname}！打席に立て！努力は裏切らんぞ！！」`);

      if (isNew) {
        this.sync.syncUser(user);
      }
    }

    setCoachSpeech(text) {
      if (this.coachBubble) {
        this.coachBubble.textContent = text;
      }
    }

    updateTimerDisplay(data) {
      this.probTimerBadge.textContent = `勝負時間: ${data.problemSeconds}秒`;
    }

    handleIdleChange(isIdle) {
      if (isIdle) {
        this.idleModal.classList.add('active');
        this.setCoachSpeech('「おい！タイムだ！汗を拭いて気合を入れ直せ！！」');
      } else {
        this.idleModal.classList.remove('active');
      }
    }

    nextProblem() {
      this.currentProblem = generateProblem(this.problemMode);
      
      const f1Str = this.currentProblem.frac1 ? this.formatFrac(this.currentProblem.frac1) : '';
      const f2Str = this.currentProblem.frac2 ? this.formatFrac(this.currentProblem.frac2) : '';
      this.currentProblem.formula = `${f1Str} ${this.currentProblem.op} ${f2Str}`;
      this.currentProblem.correctAnswer = this.formatAns(this.currentProblem.answer);

      this.pitchNumberBadge.textContent = `第 ${this.pitchCount} 球！ 勝負！`;
      this.categoryBadge.textContent = this.currentProblem.category;
      this.renderFormula(this.currentProblem);
      this.resetInputs();
      this.clearFeedback();
      this.tracker.startNewProblem(this.currentProblem);

      // 対戦相手投手を登録児童名簿（または名作ライバル投手陣）から毎回ランダム選出
      const currentUser = this.auth.getCurrentUser();
      const myName = currentUser ? currentUser.nickname : '';
      const registered = (this.auth && typeof this.auth.getAllRegisteredNicknames === 'function')
        ? this.auth.getAllRegisteredNicknames(myName)
        : [];
      let rivalPitcher = '';
      if (registered && registered.length > 0) {
        rivalPitcher = registered[Math.floor(Math.random() * registered.length)];
      } else {
        const defaultRivals = ['星飛雄馬', '花形満', '左門豊作', '伴宙太', '剛速球エース'];
        rivalPitcher = defaultRivals[Math.floor(Math.random() * defaultRivals.length)];
      }

      // ピッチャー投球モーション開始＆火の玉ボール飛来
      if (this.showdown) {
        this.showdown.setPitcherName(rivalPitcher);
        this.showdown.pitch();
      }
    }

    renderFormula(prob) {
      if (!prob) return;
      const renderTerm = (term) => {
        if (!term) return '';
        let html = '<div class="fraction-term">';
        if (term.whole > 0) {
          html += `<span class="frac-whole">${term.whole}</span>`;
        }
        if (term.num > 0 && term.den > 1) {
          html += `
            <div class="frac-vertical">
              <span class="frac-num">${term.num}</span>
              <span class="frac-den">${term.den}</span>
            </div>
          `;
        } else if (term.whole === 0 && term.num === 0) {
          html += `<span class="frac-whole">0</span>`;
        }
        html += '</div>';
        return html;
      };

      const term1 = prob.frac1 || prob.term1;
      const term2 = prob.frac2 || prob.term2;
      const leftHtml = renderTerm(term1);
      const rightHtml = renderTerm(term2);
      const opSymbol = prob.op === '+' ? '＋' : '－';

      this.formulaEl.innerHTML = `
        ${leftHtml}
        <span class="operator">${opSymbol}</span>
        ${rightHtml}
        <span class="equals">＝</span>
      `;
    }

    formatFrac(f) {
      if (!f) return '';
      if (f.whole > 0 && f.num > 0) return `${f.whole}と${f.num}/${f.den}`;
      if (f.whole > 0) return `${f.whole}`;
      return `${f.num}/${f.den}`;
    }

    formatAns(a) {
      if (!a) return '';
      if (a.isInteger || a.num === 0) return String(a.whole);
      if (a.whole === 0) return `${a.num}/${a.den}`;
      return `${a.whole}と${a.num}/${a.den}`;
    }

    resetInputs() {
      this.inputWhole.value = '';
      this.inputNum.value = '';
      this.inputDen.value = '';
      this.setActiveInput(this.inputWhole);
    }

    setActiveInput(box) {
      [this.inputWhole, this.inputNum, this.inputDen].forEach(b => {
        if (b) b.classList.remove('active-target');
      });
      [this.slotTabWhole, this.slotTabNum, this.slotTabDen].forEach(t => {
        if (t) t.classList.remove('active');
      });

      if (box) {
        this.activeInputBox = box;
        box.classList.add('active-target');

        // 対応するスロットタブをハイライト
        if (box === this.inputWhole && this.slotTabWhole) {
          this.slotTabWhole.classList.add('active');
        } else if (box === this.inputNum && this.slotTabNum) {
          this.slotTabNum.classList.add('active');
        } else if (box === this.inputDen && this.slotTabDen) {
          this.slotTabDen.classList.add('active');
        }

        if (typeof box.focus === 'function') {
          try { box.focus(); } catch (e) {}
        }
      }
    }

    // つぎの枠へ移動（整数 ➡ 分子 ➡ 分母 ➡ 整数）
    nextInputSlot() {
      if (this.activeInputBox === this.inputWhole) {
        this.setActiveInput(this.inputNum);
      } else if (this.activeInputBox === this.inputNum) {
        this.setActiveInput(this.inputDen);
      } else {
        this.setActiveInput(this.inputWhole);
      }
    }

    // テンキーによる数字入力
    inputNumpadDigit(digit) {
      if (!this.activeInputBox) {
        this.setActiveInput(this.inputWhole);
      }
      const box = this.activeInputBox;
      const maxLen = Number(box.getAttribute('maxlength')) || 3;
      if (box.value.length < maxLen) {
        box.value += String(digit);
      }
    }

    // 1文字消去（Backspace）
    numpadBackspace() {
      if (!this.activeInputBox) return;
      this.activeInputBox.value = this.activeInputBox.value.slice(0, -1);
    }

    // 全消去（AC）
    numpadClear() {
      if (!this.activeInputBox) return;
      this.activeInputBox.value = '';
    }

    checkAnswerNow() {
      try {
        if (!this.currentProblem) return;

        const wholeStr = this.inputWhole.value.trim();
        const numStr = this.inputNum.value.trim();
        const denStr = this.inputDen.value.trim();

        if (!wholeStr && !numStr && !denStr) {
          this.showFeedback('warning', 'バットを振れ！答えを入力するんだ！');
          this.setActiveInput(this.inputWhole);
          return;
        }

        const inputVal = {
          whole: wholeStr,
          num: numStr,
          den: denStr
        };

        const result = checkAnswer(inputVal, this.currentProblem);

        const userAnswerDisplay = wholeStr
          ? (numStr ? `${wholeStr}と${numStr}/${denStr}` : wholeStr)
          : (numStr ? `${numStr}/${denStr}` : '0');
        const correctDisplay = this.currentProblem.correctAnswer || (this.currentProblem.answer ? this.formatAns(this.currentProblem.answer) : '');

        if (result.isCorrect) {
          const isFirstTry = this.tracker.currentProblemMistakes === 0;
          this.tracker.recordSolve(this.currentProblem, userAnswerDisplay, this.auth.getCurrentUser());

          // ☁️ 未保存スコアが発生したので即座に「今すぐ保存 (N)」へボタンを切り替え！
          if (this.sync) {
            this.sync.checkAndNotify();
          }

          // 連続ヒットカウント
          this.comboCount++;
          this.pitchCount++;

          // 🌟 正解演出！「カキーン！！」快音 ＆ 画面揺れ ＆ 特大エフェクト
          this.triggerHitEffect(isFirstTry);
          if (this.showdown) {
            this.showdown.swingHit(isFirstTry);
          }

          // 監督の熱血台詞
          if (isFirstTry) {
            const praises = [
              '「うむ！会心の当たりだ！！カキーン！！」',
              '「ナイスバッティング！努力は裏切らんぞ！！」',
              '「スタンドイン！特大ホームランだ！！」',
              '「完璧なスイングだ！その調子で行け！！」'
            ];
            this.setCoachSpeech(praises[Math.floor(Math.random() * praises.length)]);
          } else {
            this.setCoachSpeech('「粘って打ったな！泥臭く食らいつけ！！」');
          }

          this.showFeedback('correct', `⚾ カキーン！！ 正解だ！！ (答え: ${correctDisplay})`);
          this.updateGrowthDashboard();

          // 1000本達成判定
          const user = this.auth.getCurrentUser();
          const stats = this.tracker.getStatsComparison(user);
          if (stats && stats.knocks && stats.knocks.done === 1000) {
            setTimeout(() => {
              this.goalModal.classList.add('active');
            }, 800);
          }

          setTimeout(() => {
            this.nextProblem();
          }, 1100);

        } else {
          // 不正解演出（豪快な空振り三振）
          this.comboCount = 0;
          if (this.showdown) {
            this.showdown.swingMiss();
          } else {
            this.sound.playWrong();
          }
          this.tracker.recordMistake(userAnswerDisplay, result.message);

          const scolds = [
            '「バカモン！！まだ腰が入っとらん！！もう一丁！！」',
            '「ボール球に手を出すな！通分をしっかり見極めろ！！」',
            '「歯を食いしばれ！気合で食らいつくんだ！！」'
          ];
          this.setCoachSpeech(scolds[Math.floor(Math.random() * scolds.length)]);
          this.showFeedback('wrong', `💥 空振り三振！ ${result.message}`);

          if (result.status !== 'correct') {
            if (!this.inputNum.value && !this.inputDen.value) {
              this.setActiveInput(this.inputWhole);
            } else {
              this.setActiveInput(this.inputNum);
            }
          }
        }
      } catch (err) {
        console.error('解答判定エラー:', err);
        this.showFeedback('warning', 'エラーが発生したぞ！もう一度Enterを押せ！');
      }
    }

    // 🌟 カキーン！演出（快音・画面揺れ・オノマトペ）
    triggerHitEffect(isHomerun = false) {
      if (isHomerun) {
        this.sound.playHomerun();
        this.hitEffectText.textContent = '特大ホームラン！！';
      } else {
        this.sound.playHit();
        this.hitEffectText.textContent = 'カキーン！！';
      }

      // 画面シェイク
      this.appViewport.classList.remove('screen-shake');
      void this.appViewport.offsetWidth; // リフロー強制
      this.appViewport.classList.add('screen-shake');

      // オノマトペレイヤー表示
      this.hitEffectOverlay.classList.remove('active');
      void this.hitEffectOverlay.offsetWidth;
      this.hitEffectOverlay.classList.add('active');

      setTimeout(() => {
        this.hitEffectOverlay.classList.remove('active');
        this.appViewport.classList.remove('screen-shake');
      }, 700);
    }

    clearFeedback() {
      this.feedbackBox.className = 'feedback-box feedback-empty';
      this.feedbackBox.textContent = '';
    }

    showFeedback(type, text) {
      this.feedbackBox.className = `feedback-box feedback-${type}`;
      this.feedbackBox.textContent = text;
    }

    // 猛特訓スコアボード（ダッシュボード）更新
    updateGrowthDashboard() {
      const user = this.auth.getCurrentUser();
      const stats = this.tracker.getStatsComparison(user);
      const k = stats.knocks;

      // 1000本ノックスコアボード
      if (k.isCompleted) {
        this.knockStatusLabel.textContent = '🔥 魂の追加特打！';
        this.knockRemainingDisplay.textContent = `${k.done}`;
        this.knockUnit.textContent = '本目！！';
        this.knockProgress.style.width = '100%';
        this.knockSubText.textContent = `猛者認定済！ 限界突破中 (+${k.extra}本)`;
      } else {
        this.knockStatusLabel.textContent = '🔥 魂の1000本ノック 残り';
        this.knockRemainingDisplay.textContent = `${k.remaining}`;
        this.knockUnit.textContent = '本！！';
        this.knockProgress.style.width = `${k.percent}%`;
        this.knockSubText.textContent = `打倒・分数の壁！ ${k.done} / ${k.target} 本 (${k.percent}%)`;
      }

      // 1. 本日特打
      this.statTodaySolved.textContent = `${stats.today.count}本`;
      this.statTodayTime.textContent = `特打時間: ${stats.today.todayMinutes}分`;

      // 2. 1発打率
      const rate = (stats.today.accuracy / 100).toFixed(3).replace(/^0/, '');
      this.statTodayAcc.textContent = stats.today.count > 0 ? `.${rate.replace('.', '')}` : '1.000';
      if (stats.past.count > 0) {
        const pastRate = (stats.past.accuracy / 100).toFixed(3).replace(/^0/, '');
        this.statPastAcc.textContent = `通算打率: .${pastRate.replace('.', '')}`;
        if (stats.accDiff !== null && stats.accDiff > 0) {
          this.statAccBadge.className = 'growth-badge up';
          this.statAccBadge.textContent = `📈 打率UP!`;
        }
      } else {
        this.statPastAcc.textContent = `通算: -`;
      }

      // 3. スイング速度
      if (stats.today.count > 0) {
        this.statTodaySpeed.textContent = `${stats.today.avgSec}秒`;
      } else {
        this.statTodaySpeed.textContent = `-`;
      }
      if (stats.past.count > 0) {
        this.statPastSpeed.textContent = `通算: ${stats.past.avgSec}秒`;
        if (stats.speedDiff !== null && stats.speedDiff > 0) {
          this.statSpeedBadge.className = 'growth-badge faster';
          this.statSpeedBadge.textContent = `⚡ ${stats.speedDiff}秒 速いスイング！`;
        }
      }

      // 4. 通算特打本数 ＆ 連続ヒット
      this.statAllSolved.textContent = `${stats.all.count}本`;
      this.statAllTime.textContent = `総特打: ${stats.all.totalMinutes}分`;
      this.statComboBadge.textContent = `連続 ${this.comboCount} 球ヒット！`;
    }

    bindEvents() {
      // ステップ1: クラス・番号選択後に「次へ進む！」（超高速・タイムアウト保証）
      this.btnStepNext.addEventListener('click', async () => {
        this.selectedClass = this.authClass.value;
        this.selectedNumber = this.authNumber.value;

        const origText = this.btnStepNext.textContent;
        this.btnStepNext.textContent = '☁️ 名簿確認中...';
        this.btnStepNext.disabled = true;

        let check = this.auth.checkStudent(this.selectedClass, this.selectedNumber);

        try {
          // 既知なら3秒、未登録時は混雑時も安心の最大12秒待ってGASから最新名簿を確実に取得
          const timeout = check.exists ? 3000 : 12000;
          const users = await this.sync.fetchUsersFromSheet(timeout);
          if (users && users.length > 0) {
            this.auth.syncWithRemoteUsers(users);
            check = this.auth.checkStudent(this.selectedClass, this.selectedNumber);
          }
        } catch (e) {
          console.warn('名簿確認スキップ (ローカルキャッシュ優先):', e);
        } finally {
          this.btnStepNext.textContent = origText;
          this.btnStepNext.disabled = false;
        }

        // 次の画面へ遷移
        this.authStepSelect.style.display = 'none';

        if (check.exists) {
          this.confirmClassNum.textContent = `${this.selectedClass} ${this.selectedNumber}番`;
          this.confirmNickname.textContent = check.nickname;
          this.authStepConfirm.style.display = 'block';
          this.authStepRegister.style.display = 'none';
        } else {
          this.registerClassNum.textContent = `${this.selectedClass} ${this.selectedNumber}番`;
          this.inputNickname.value = '';
          this.authStepRegister.style.display = 'block';
          this.authStepConfirm.style.display = 'none';
          setTimeout(() => this.inputNickname.focus(), 100);
        }
      });

      // ステップ2-A: 「よし、特訓開始だ！！」
      this.btnStartConfirmed.addEventListener('click', () => {
        const user = this.auth.loginExisting(this.selectedClass, this.selectedNumber);
        if (user) {
          this.onLoginComplete(user, false);
        }
      });

      // ステップ2-A: 「名前を修正する / 別の選手」
      this.btnEditNickname.addEventListener('click', () => {
        const check = this.auth.checkStudent(this.selectedClass, this.selectedNumber);
        this.registerClassNum.textContent = `${this.selectedClass} ${this.selectedNumber}番`;
        this.inputNickname.value = check.nickname || '';
        this.authStepConfirm.style.display = 'none';
        this.authStepRegister.style.display = 'block';
        setTimeout(() => this.inputNickname.focus(), 100);
      });

      // ステップ2-B: 「登録してバッターボックスへ！」
      this.btnSaveNickname.addEventListener('click', () => {
        const nick = this.inputNickname.value.trim();
        if (!nick) {
          alert('登録名を入力するんだ！');
          this.inputNickname.focus();
          return;
        }
        const user = this.auth.loginWithNickname(this.selectedClass, this.selectedNumber, nick);
        this.onLoginComplete(user, true);
      });

      // ステップ2-B: 「クラス・番号を選び直す」
      this.btnBackToSelect.addEventListener('click', () => {
        this.authStepRegister.style.display = 'none';
        this.authStepConfirm.style.display = 'none';
        this.authStepSelect.style.display = 'block';
      });

      // キーボード操作
      const boxes = [this.inputWhole, this.inputNum, this.inputDen];
      boxes.forEach(box => {
        box.addEventListener('focus', () => this.setActiveInput(box));
        box.addEventListener('click', () => this.setActiveInput(box));
      });

      this.inputWhole.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.checkAnswerNow();
        } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.setActiveInput(this.inputNum);
          }
        }
      });

      this.inputNum.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.checkAnswerNow();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.setActiveInput(this.inputDen);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.setActiveInput(this.inputWhole);
        }
      });

      this.inputDen.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.checkAnswerNow();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.setActiveInput(this.inputNum);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.setActiveInput(this.inputWhole);
        }
      });

      // 特訓テンキー スロットタブ（直接選択）
      if (this.slotTabWhole) this.slotTabWhole.addEventListener('click', () => this.setActiveInput(this.inputWhole));
      if (this.slotTabNum) this.slotTabNum.addEventListener('click', () => this.setActiveInput(this.inputNum));
      if (this.slotTabDen) this.slotTabDen.addEventListener('click', () => this.setActiveInput(this.inputDen));

      // 特訓テンキー 数字キー（0-9）
      if (this.numpadBtns) {
        this.numpadBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const num = btn.getAttribute('data-num');
            this.inputNumpadDigit(num);
          });
        });
      }

      // 特訓テンキー 1文字消去 ＆ ACクリア
      if (this.btnNumpadBs) {
        this.btnNumpadBs.addEventListener('click', () => this.numpadBackspace());
      }
      if (this.btnNumpadAc) {
        this.btnNumpadAc.addEventListener('click', () => this.numpadClear());
      }

      // 特訓テンキー つぎの枠へ移動ボタン
      if (this.btnNumpadNextSlot) {
        this.btnNumpadNextSlot.addEventListener('click', () => this.nextInputSlot());
      }

      // グローバル物理キーボード操作（inputmode="none"でもPC等から入力可能に）
      window.addEventListener('keydown', (e) => {
        // モーダル表示中は無効
        if (this.authModal && this.authModal.classList.contains('active')) return;
        if (this.logModal && this.logModal.classList.contains('active')) return;
        if (this.idleModal && this.idleModal.classList.contains('active')) return;
        if (this.goalModal && this.goalModal.classList.contains('active')) return;
        if (this.rankingModal && this.rankingModal.classList.contains('active')) return;

        if (/^[0-9]$/.test(e.key)) {
          this.inputNumpadDigit(e.key);
        } else if (e.key === 'Backspace') {
          this.numpadBackspace();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          this.nextInputSlot();
        }
      });

      // フルスイングボタン
      if (this.btnCheck) {
        this.btnCheck.addEventListener('click', () => this.checkAnswerNow());
      }

      // スコア保存ボタン
      this.btnSync.addEventListener('click', async () => {
        const res = await this.sync.syncNow(true);
        if (res.status === 'success') {
          this.setCoachSpeech(`「よし！先生のスプレッドシートへ ${res.count} 球の打撃記録を保存したぞ！！」`);
        }
      });

      // 放置再開
      this.btnResume.addEventListener('click', () => {
        this.tracker.resumeFromIdle();
      });

      // 1000本完走モーダル追加特打ボタン
      this.btnContinueExtra.addEventListener('click', () => {
        this.goalModal.classList.remove('active');
        this.setCoachSpeech('「限界突破だ！！1000本を超えてこそ真の男だ！！」');
      });

      // 記録モーダル
      this.btnShowLogs.addEventListener('click', () => {
        this.renderLogTable();
        this.logModal.classList.add('active');
      });
      this.btnCloseLogs.addEventListener('click', () => {
        this.logModal.classList.remove('active');
      });
      this.btnCloseLogsBottom.addEventListener('click', () => {
        this.logModal.classList.remove('active');
      });

      // 🏆 ランキングモーダル表示・非表示
      if (this.btnShowRanking) {
        this.btnShowRanking.addEventListener('click', () => this.openRankingModal(false));
      }
      if (this.btnOpenRankingFromAuth) {
        this.btnOpenRankingFromAuth.addEventListener('click', () => this.openRankingModal(true));
      }
      if (this.btnOpenRankingFromAuth2) {
        this.btnOpenRankingFromAuth2.addEventListener('click', () => this.openRankingModal(true));
      }
      if (this.btnOpenRankingFromGoal) {
        this.btnOpenRankingFromGoal.addEventListener('click', () => this.openRankingModal(false));
      }
      if (this.btnCloseRanking) {
        this.btnCloseRanking.addEventListener('click', () => this.closeRankingModal());
      }
      if (this.btnCloseRankingBottom) {
        this.btnCloseRankingBottom.addEventListener('click', () => this.closeRankingModal());
      }
      if (this.rankingClassFilter) {
        this.rankingClassFilter.addEventListener('change', () => this.renderRankingTable());
      }
      if (this.btnRefreshRanking) {
        this.btnRefreshRanking.addEventListener('click', () => this.refreshRankingData());
      }
    }

    initScratchCanvas() {
      const canvas = document.getElementById('scratchCanvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const container = canvas.parentElement;

      const resize = () => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          canvas.width = container.clientWidth;
          canvas.height = container.clientHeight;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
      };
      resize();
      window.addEventListener('resize', resize);

      let drawing = false;
      let mode = 'pen';

      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
          x: clientX - rect.left,
          y: clientY - rect.top
        };
      };

      const startDraw = (e) => {
        drawing = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        if (e.type === 'touchstart') e.preventDefault();
      };

      const draw = (e) => {
        if (!drawing) return;
        const pos = getPos(e);
        if (mode === 'eraser') {
          ctx.strokeStyle = '#fffdf5';
          ctx.lineWidth = 20;
        } else if (mode === 'red') {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 3;
        } else {
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 3;
        }
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (e.type === 'touchmove') e.preventDefault();
      };

      const stopDraw = () => {
        drawing = false;
      };

      canvas.addEventListener('mousedown', startDraw);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stopDraw);
      canvas.addEventListener('mouseleave', stopDraw);

      canvas.addEventListener('touchstart', startDraw, { passive: false });
      canvas.addEventListener('touchmove', draw, { passive: false });
      canvas.addEventListener('touchend', stopDraw);

      const toolPen = document.getElementById('toolPen');
      const toolEraser = document.getElementById('toolEraser');
      const toolClear = document.getElementById('toolClear');

      toolPen.addEventListener('click', () => {
        mode = 'pen';
        toolPen.classList.add('active');
        toolEraser.classList.remove('active');
      });

      toolEraser.addEventListener('click', () => {
        mode = 'eraser';
        toolEraser.classList.add('active');
        toolPen.classList.remove('active');
      });

      toolClear.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      });
    }

    renderLogTable() {
      const user = this.auth.getCurrentUser();
      let logs = this.tracker.getTodayLogs(user);
      if (!logs || logs.length === 0) {
        // 本日分が0件でも全打席記録があればフォールバック表示
        const all = this.tracker.getAllLogs();
        if (all && all.length > 0) {
          logs = all;
        }
      }

      if (!logs || logs.length === 0) {
        this.logTableBody.innerHTML = '<tr><td colspan="6" style="padding: 24px; color: #64748b; text-align: center;">本日の打撃記録はまだありません。バッターボックスへ立ってフルスイングしよう！</td></tr>';
        return;
      }

      this.logTableBody.innerHTML = logs.slice().reverse().map(log => {
        const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
        const mistakeBadge = (log.mistakeCount === 0)
          ? '<span style="color:#15803d; font-weight:bold;">1発クリーンヒット⚾</span>'
          : `<span style="color:#b91c1c; font-weight:bold;">${log.mistakeCount}回空振り</span>`;
        const formulaStr = log.problem ? (log.problem.formula || '') : '';
        const answerStr = log.problem ? (log.problem.correctAnswer || '') : '';
        const categoryStr = log.problem ? (log.problem.category || '分数計算') : '分数計算';
        return `
          <tr>
            <td>${timeStr}</td>
            <td style="font-weight: bold;">${formulaStr}</td>
            <td>${answerStr}</td>
            <td>${log.timeSpentSeconds || 0}秒</td>
            <td>${mistakeBadge}</td>
            <td style="font-size: 0.8rem; color: #64748b;">${categoryStr}</td>
          </tr>
        `;
      }).join('');
    }

    // =========================================================================
    // 🏆 熱血！1000本ノック猛者番付（ランキング）処理
    // =========================================================================
    async openRankingModal(fromAuth = false) {
      this.rankingFromAuth = fromAuth;
      if (fromAuth && this.authModal) {
        this.authModal.classList.remove('active');
      }
      if (this.rankingModal) {
        this.rankingModal.classList.add('active');
      }

      // まずローカル保存済みの名簿から即時描画
      this.renderRankingTable();

      // バックグラウンドで最新データをスプレッドシートから取得して再描画
      try {
        const users = await this.sync.fetchUsersFromSheet(8000);
        if (users && users.length > 0) {
          this.auth.syncWithRemoteUsers(users);
          this.renderRankingTable();
        }
      } catch (e) {
        console.warn('Ranking background fetch warning:', e);
      }
    }

    closeRankingModal() {
      if (this.rankingModal) {
        this.rankingModal.classList.remove('active');
      }
      // 入部届（トップ画面）から開いており、まだログイン前なら入部届を再表示
      if (this.rankingFromAuth && (!this.auth || !this.auth.isLoggedIn())) {
        if (this.authModal) {
          this.authModal.classList.add('active');
        }
      }
      this.rankingFromAuth = false;
    }

    async refreshRankingData() {
      if (!this.btnRefreshRanking) return;
      this.btnRefreshRanking.disabled = true;
      if (this.btnRefreshRankingText) {
        this.btnRefreshRankingText.textContent = '⏳ 更新中...';
      }

      try {
        const users = await this.sync.fetchUsersFromSheet(12000);
        if (users && users.length > 0) {
          this.auth.syncWithRemoteUsers(users);
        }
        this.renderRankingTable();
        if (this.btnRefreshRankingText) {
          this.btnRefreshRankingText.textContent = '✅ 更新完了！';
        }
      } catch (e) {
        console.warn('Failed to refresh ranking manually:', e);
        if (this.btnRefreshRankingText) {
          this.btnRefreshRankingText.textContent = '⚠️ 更新失敗';
        }
      } finally {
        setTimeout(() => {
          if (this.btnRefreshRanking) {
            this.btnRefreshRanking.disabled = false;
          }
          if (this.btnRefreshRankingText) {
            this.btnRefreshRankingText.textContent = '🔄 最新データ更新';
          }
        }, 1500);
      }
    }

    renderRankingTable() {
      if (!this.rankingTableBody) return;

      const TARGET = 1000;
      const currentUser = this.auth ? this.auth.getCurrentUser() : null;
      let allUsers = (this.auth && typeof this.auth.getAllUsersForRanking === 'function')
        ? this.auth.getAllUsersForRanking()
        : [];

      // 現在ログイン中の児童の最新データをマージ（未同期の本日のローカルログも加味）
      if (currentUser) {
        const stats = this.tracker.getStatsComparison(currentUser);
        const myTotal = stats.knocks.done;
        const myKey = this.auth.makeKey(currentUser.className, currentUser.studentNumber);

        let found = false;
        allUsers.forEach(u => {
          if (this.auth.makeKey(u.className, u.studentNumber) === myKey) {
            u.totalSolved = Math.max(Number(u.totalSolved) || 0, myTotal);
            if (stats.today.accuracy !== null && stats.today.accuracy !== undefined) {
              u.accuracy = stats.today.accuracy;
            }
            if (!u.nickname && currentUser.nickname) {
              u.nickname = currentUser.nickname;
            }
            found = true;
          }
        });

        if (!found) {
          allUsers.push({
            className: currentUser.className,
            studentNumber: Number(currentUser.studentNumber),
            nickname: currentUser.nickname,
            totalSolved: myTotal,
            accuracy: stats.today.accuracy,
            avgSeconds: stats.today.avgSec,
            lastStudyAt: ''
          });
        }
      }

      // 絞り込みフィルター（クラス）
      const filterVal = this.rankingClassFilter ? this.rankingClassFilter.value : 'ALL';
      let filtered = allUsers.filter(u => {
        // ニックネームがある、または 1問以上解いている児童のみ表示
        const hasNick = Boolean((u.nickname || '').trim());
        const hasSolved = (Number(u.totalSolved) || 0) > 0;
        if (!hasNick && !hasSolved) return false;

        if (filterVal === 'ALL') return true;
        // クラス名の正規化比較（「組」の直前の数字を比較）
        const filterMatch = filterVal.match(/([1-6])\s*組/);
        const userMatch = String(u.className || '').match(/([1-6])\s*組/);
        if (filterMatch && userMatch) {
          return filterMatch[1] === userMatch[1];
        }
        return u.className === filterVal;
      });

      // ソート：
      // 1. 解いた総問題数（降順）
      // 2. 1発正解率（降順）
      // 3. 出席番号（昇順）
      filtered.sort((a, b) => {
        const diffSolved = (Number(b.totalSolved) || 0) - (Number(a.totalSolved) || 0);
        if (diffSolved !== 0) return diffSolved;
        const diffAcc = (Number(b.accuracy) || 0) - (Number(a.accuracy) || 0);
        if (diffAcc !== 0) return diffAcc;
        return (Number(a.studentNumber) || 0) - (Number(b.studentNumber) || 0);
      });

      // 自分の順位を見つける
      let myRank = null;
      let myData = null;
      if (currentUser) {
        const myKey = this.auth.makeKey(currentUser.className, currentUser.studentNumber);
        const idx = filtered.findIndex(u => this.auth.makeKey(u.className, u.studentNumber) === myKey);
        if (idx >= 0) {
          myRank = idx + 1;
          myData = filtered[idx];
        }
      }

      // 自分の順位バナーの更新
      if (this.myRankBanner) {
        if (currentUser && myData) {
          this.myRankBanner.style.display = 'flex';
          this.myRankBadge.textContent = `第 ${myRank} 位 / ${filtered.length}人中`;
          const mySolved = Number(myData.totalSolved) || 0;
          this.myRankName.textContent = `⚾ ${currentUser.className} ${currentUser.studentNumber}番 ${currentUser.nickname} 選手`;
          if (mySolved >= TARGET) {
            const extra = mySolved - TARGET;
            this.myRankStat.innerHTML = `🏆 <strong>祝・1000本完走！</strong> 猛者追加特打: <strong>+${extra}問</strong>（通算 ${mySolved}本）`;
          } else {
            const rem = TARGET - mySolved;
            const pct = Math.min(100, Math.round((mySolved / TARGET) * 100));
            this.myRankStat.innerHTML = `通算 <strong>${mySolved}本</strong> (1000本まで <strong>あと ${rem}問！</strong> 進捗 ${pct}%)`;
          }
        } else {
          this.myRankBanner.style.display = 'none';
        }
      }

      // テーブルが空の場合
      if (filtered.length === 0) {
        this.rankingTableBody.innerHTML = '';
        if (this.rankingEmptyMsg) this.rankingEmptyMsg.style.display = 'block';
        return;
      }
      if (this.rankingEmptyMsg) this.rankingEmptyMsg.style.display = 'none';

      // テーブル行生成
      this.rankingTableBody.innerHTML = filtered.map((u, i) => {
        const rank = i + 1;
        const totalSolved = Number(u.totalSolved) || 0;
        const isCompleted = totalSolved >= TARGET;
        const isMe = currentUser && (this.auth.makeKey(u.className, u.studentNumber) === this.auth.makeKey(currentUser.className, currentUser.studentNumber));

        // 順位バッジ
        let rankBadgeHtml = '';
        if (rank === 1) {
          rankBadgeHtml = '<span class="rank-badge rank-1">🥇 1位</span>';
        } else if (rank === 2) {
          rankBadgeHtml = '<span class="rank-badge rank-2">🥈 2位</span>';
        } else if (rank === 3) {
          rankBadgeHtml = '<span class="rank-badge rank-3">🥉 3位</span>';
        } else {
          rankBadgeHtml = `<span class="rank-badge rank-normal">${rank}位</span>`;
        }

        // 選手名
        const nickDisplay = (u.nickname || '選手').trim();
        const classNumDisplay = `${u.className || ''} ${u.studentNumber ? u.studentNumber + '番' : ''}`;
        const meTag = isMe ? '<span class="my-player-tag">あなた</span>' : '';

        // 目標達成状況（要求の中核：あと何問か、1000問完走なら追加練習で何問か）
        let statusBadgeHtml = '';
        let barClass = 'bar-fill-normal';
        let barWidth = 0;

        if (isCompleted) {
          const extra = totalSolved - TARGET;
          statusBadgeHtml = `<span class="status-badge status-over-1000">🔥 完走！追加 +${extra}問</span>`;
          barClass = 'bar-fill-gold';
          barWidth = 100;
        } else {
          const remaining = TARGET - totalSolved;
          const pct = Math.min(100, Math.round((totalSolved / TARGET) * 100));
          statusBadgeHtml = `<span class="status-badge status-under-1000">あと <strong>${remaining}</strong>問 (${pct}%)</span>`;
          barWidth = pct;
        }

        // 打率
        let accStr = '-';
        if (u.accuracy !== null && u.accuracy !== undefined && !isNaN(u.accuracy)) {
          accStr = `${Math.round(u.accuracy)}%`;
        }

        const rowClass = isMe ? 'class="my-rank-row"' : '';

        return `
          <tr ${rowClass}>
            <td>${rankBadgeHtml}</td>
            <td>
              <div class="player-col-wrap">
                <span class="player-main-name">${nickDisplay}</span>
                <span class="player-class-num">${classNumDisplay}</span>
                ${meTag}
              </div>
            </td>
            <td>${statusBadgeHtml}</td>
            <td>
              <div class="rank-solved-wrap">
                <div class="rank-solved-num-row">
                  <span class="rank-solved-num">${totalSolved}</span>
                  <span class="rank-solved-unit">本</span>
                </div>
                <div class="rank-mini-bar-bg">
                  <div class="rank-mini-bar-fill ${barClass}" style="width: ${barWidth}%;"></div>
                </div>
              </div>
            </td>
            <td style="font-weight: bold; color: #1e293b;">${accStr}</td>
          </tr>
        `;
      }).join('');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.keisanApp = new App();
  });
})();
