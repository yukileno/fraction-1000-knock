/**
 * 熱血1000本ノック トラッカー ＆ 放置検知 ＆ 成績集計
 * UMD形式（ブラウザ直接読み込み・Node.js両対応）
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.StudyTracker = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const STORAGE_KEY_SESSION = 'keisan_session_active_v1';
  const STORAGE_KEY_LOGS = 'keisan_problem_logs_v1';
  const IDLE_LIMIT_SECONDS = 60; // 60秒間無操作で放置と判定
  const TARGET_KNOCKS = 1000;    // 1000本ノック！

  class StudyTracker {
    constructor(options = {}) {
      this.targetKnocks = options.targetKnocks || TARGET_KNOCKS;
      this.onTick = options.onTick || (() => {});
      this.onIdleStateChange = options.onIdleStateChange || (() => {});
      this.onTargetReached = options.onTargetReached || (() => {});

      this.activeSeconds = 0;
      this.isRunning = false;
      this.isIdle = false;
      this.isTabHidden = false;
      this.isBlurred = false;
      this.idleTimerSeconds = 0;
      this.targetReachedFired = false;

      this.currentProblemStartTime = 0;
      this.currentProblemActiveSeconds = 0;
      this.currentProblemMistakes = 0;
      this.currentProblemHistory = [];

      this.sessionId = this.getOrCreateSessionId();
      this.loadTodaySession();

      this.setupActivityListeners();
      this.setupVisibilityListener();
    }

    getOrCreateSessionId() {
      if (typeof sessionStorage === 'undefined') return 'sess_node';
      let id = sessionStorage.getItem('keisan_current_session_id');
      if (!id) {
        id = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        sessionStorage.setItem('keisan_current_session_id', id);
      }
      return id;
    }

    loadTodaySession() {
      if (typeof localStorage === 'undefined') return;
      try {
        const saved = localStorage.getItem(STORAGE_KEY_SESSION);
        if (saved) {
          const data = JSON.parse(saved);
          const todayStr = new Date().toDateString();
          if (data.date === todayStr) {
            this.activeSeconds = data.activeSeconds || 0;
          }
        }
      } catch (e) {
        console.warn('Failed to load session:', e);
      }
    }

    saveSession() {
      if (typeof localStorage === 'undefined') return;
      try {
        const data = {
          date: new Date().toDateString(),
          sessionId: this.sessionId,
          activeSeconds: this.activeSeconds,
          updatedAt: new Date().toISOString()
        };
        localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(data));
      } catch (e) {
        console.warn('Failed to save session:', e);
      }
    }

    setupActivityListeners() {
      if (typeof window === 'undefined') return;
      const resetIdle = () => {
        this.idleTimerSeconds = 0;
        if (this.isIdle) {
          this.resumeFromIdle();
        }
      };

      window.addEventListener('mousemove', resetIdle, { passive: true });
      window.addEventListener('keydown', resetIdle, { passive: true });
      window.addEventListener('touchstart', resetIdle, { passive: true });
      window.addEventListener('pointerdown', resetIdle, { passive: true });
    }

    setupVisibilityListener() {
      if (typeof document === 'undefined') return;

      // 他タブ閲覧・画面最小化などの不可視状態を検知してタイムストップ
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.isTabHidden = true;
          this.pause('tab_hidden');
        } else {
          this.isTabHidden = false;
          if (!this.isIdle && !this.isBlurred) {
            this.start();
          }
        }
      });

      // 他ウィンドウや別アプリへのフォーカス離脱を検知してタイムストップ
      if (typeof window !== 'undefined') {
        window.addEventListener('blur', () => {
          this.isBlurred = true;
          this.pause('window_blur');
        });

        window.addEventListener('focus', () => {
          this.isBlurred = false;
          if (!this.isTabHidden && !this.isIdle) {
            this.start();
          }
        });
      }
    }

    start() {
      if (this.intervalId) return;
      this.isRunning = true;

      this.intervalId = setInterval(() => {
        if (this.isTabHidden || this.isBlurred || this.isIdle) return;

        this.idleTimerSeconds++;
        if (this.idleTimerSeconds >= IDLE_LIMIT_SECONDS) {
          this.triggerIdle();
          return;
        }

        this.activeSeconds++;
        this.currentProblemActiveSeconds++;

        if (this.activeSeconds % 5 === 0) {
          this.saveSession();
        }

        this.onTick({
          activeSeconds: this.activeSeconds,
          problemSeconds: this.currentProblemActiveSeconds
        });
      }, 1000);
    }

    pause(reason = 'manual') {
      this.isRunning = false;
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.saveSession();
    }

    triggerIdle() {
      this.isIdle = true;
      // 放置された直前の無操作時間（60秒）を実質解答時間・本日の集中時間から除外し、最後の操作時でタイムストップ
      this.currentProblemActiveSeconds = Math.max(0, this.currentProblemActiveSeconds - IDLE_LIMIT_SECONDS);
      this.activeSeconds = Math.max(0, this.activeSeconds - IDLE_LIMIT_SECONDS);
      this.pause('idle');
      this.onIdleStateChange(true);
      // 正確なタイムストップ値を即座に通知
      this.onTick({
        activeSeconds: this.activeSeconds,
        problemSeconds: this.currentProblemActiveSeconds
      });
    }

    resumeFromIdle() {
      this.isIdle = false;
      this.idleTimerSeconds = 0;
      this.onIdleStateChange(false);
      if (!this.isTabHidden && !this.isBlurred) {
        this.start();
      }
    }

    startNewProblem(problemData) {
      this.currentProblemData = problemData;
      this.currentProblemStartTime = Date.now();
      this.currentProblemActiveSeconds = 0;
      this.currentProblemMistakes = 0;
      this.currentProblemHistory = [];
    }

    recordMistake(inputVal, reason) {
      this.currentProblemMistakes++;
      this.currentProblemHistory.push({
        input: inputVal,
        reason: reason,
        atSeconds: this.currentProblemActiveSeconds
      });
    }

    setCurrentUser(user) {
      this.currentUser = user;
    }

    recordSolve(problemData, finalAnswer, userInfo = null) {
      const now = Date.now();
      const formula = problemData ? problemData.formula : '';

      // 🛡️ 同一問題の直後連続記録（1.5秒以内の連打・リピート）をブロック
      if (formula && this.lastRecordedFormula === formula && (now - (this.lastRecordedAt || 0) < 1500)) {
        console.warn('⚠️ 1.5秒以内の同一問題重複記録をスキップしました:', formula);
        return null;
      }
      this.lastRecordedFormula = formula;
      this.lastRecordedAt = now;

      const actualSeconds = this.currentProblemActiveSeconds;
      const user = userInfo || this.currentUser || {};

      const logEntry = {
        id: 'log_' + now + '_' + Math.random().toString(36).substring(2, 6),
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        className: user.className || '',
        studentNumber: user.studentNumber || '',
        nickname: user.nickname || '',
        problem: {
          category: problemData.category,
          subCategory: problemData.subCategory,
          formula: problemData.formula,
          op: problemData.op,
          correctAnswer: problemData.correctAnswer
        },
        userAnswer: finalAnswer,
        timeSpentSeconds: actualSeconds,
        mistakeCount: this.currentProblemMistakes,
        history: this.currentProblemHistory,
        syncedToSheet: false
      };

      this.saveProblemLog(logEntry);

      // 💥【リアルタイム即時更新の絶対保証】
      // 正解したその瞬間にウォーターマーク（最高正解数）を即座にインクリメント！
      if (!this.solvedWatermarks) this.solvedWatermarks = {};
      const uKey = (user && user.studentNumber)
        ? `${this.normalizeClassName(user.className)}_${user.studentNumber}`
        : 'default';
      this.solvedWatermarks[uKey] = (this.solvedWatermarks[uKey] || 0) + 1;

      return logEntry;
    }

    saveProblemLog(logEntry) {
      if (typeof localStorage === 'undefined') return;
      try {
        const logs = this.getAllLogs();
        logs.push(logEntry);
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
      } catch (e) {
        console.error('Failed to save log entry:', e);
      }
    }

    getAllLogs() {
      if (typeof localStorage === 'undefined') return [];
      try {
        const raw = localStorage.getItem(STORAGE_KEY_LOGS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    normalizeClassName(name) {
      if (!name) return '';
      const m = String(name).match(/([1-6])(?:\s*組)?/);
      return m ? `${m[1]}組` : String(name).trim();
    }

    getTodayLogs(userInfo = null) {
      const user = userInfo || this.currentUser;
      const today = new Date().toDateString();
      let logs = this.getAllLogs().filter(log => new Date(log.timestamp).toDateString() === today);
      if (user && user.studentNumber) {
        const targetClass = this.normalizeClassName(user.className);
        const targetNum = Number(user.studentNumber);
        logs = logs.filter(l => {
          // 旧形式のログ（className/studentNumber未保存）は救済表示
          if (!l.className && !l.studentNumber) return true;
          const logClass = this.normalizeClassName(l.className);
          const logNum = Number(l.studentNumber);
          return (!targetClass || !logClass || logClass === targetClass) && logNum === targetNum;
        });
      }
      return logs;
    }

    getPastLogs(userInfo = null) {
      const user = userInfo || this.currentUser;
      const today = new Date().toDateString();
      let logs = this.getAllLogs().filter(log => new Date(log.timestamp).toDateString() !== today);
      if (user && user.studentNumber) {
        const targetClass = this.normalizeClassName(user.className);
        const targetNum = Number(user.studentNumber);
        logs = logs.filter(l => {
          if (!l.className && !l.studentNumber) return true;
          const logClass = this.normalizeClassName(l.className);
          const logNum = Number(l.studentNumber);
          return (!targetClass || !logClass || logClass === targetClass) && logNum === targetNum;
        });
      }
      return logs;
    }

    // 指定ユーザーの未送信（未同期）ログ一覧を取得
    getUnsyncedLogsForUser(userInfo = null) {
      const user = userInfo || this.currentUser;
      const allLogs = this.getAllLogs();
      const unsynced = allLogs.filter(l => !l.syncedToSheet);
      if (!user || !user.studentNumber) return unsynced;
      const targetClass = this.normalizeClassName(user.className);
      const targetNum = Number(user.studentNumber);
      return unsynced.filter(l => {
        if (!l.className && !l.studentNumber) return true;
        const logClass = this.normalizeClassName(l.className);
        const logNum = Number(l.studentNumber);
        return (!targetClass || !logClass || logClass === targetClass) && logNum === targetNum;
      });
    }

    // スプレッドシートから削除された児童、または新規入部児童の古い送信済みログを端末から消去
    cleanSyncedLogsForUser(userInfo = null) {
      const user = userInfo || this.currentUser;
      if (!user || !user.studentNumber) return;
      const targetClass = this.normalizeClassName(user.className);
      const targetNum = Number(user.studentNumber);
      const uKey = `${targetClass}_${targetNum}`;
      if (this.solvedWatermarks) delete this.solvedWatermarks[uKey];
      if (this.minuteWatermarks) delete this.minuteWatermarks[uKey];

      const allLogs = this.getAllLogs();
      // 同期済み（syncedToSheet: true）の古いログのみを破棄し、未送信ログ（オフライン作業分）は保護
      const keptLogs = allLogs.filter(l => {
        if (!l.syncedToSheet) return true;
        const logClass = this.normalizeClassName(l.className);
        const logNum = Number(l.studentNumber);
        return !((!targetClass || !logClass || logClass === targetClass) && logNum === targetNum);
      });
      try {
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(keptLogs));
      } catch (e) {
        console.error('Failed to clean synced logs:', e);
      }
    }

    // 「熱血1000本ノック」成績集計＆成長比較
    getStatsComparison(userInfo = null) {
      const todayLogs = this.getTodayLogs(userInfo);
      const pastLogs = this.getPastLogs(userInfo);

      const calcStats = (logs) => {
        const count = logs.length;
        if (count === 0) {
          return { count: 0, avgSec: 0, firstTryCount: 0, accuracy: 100, totalMinutes: 0 };
        }
        const totalSec = logs.reduce((sum, l) => sum + (l.timeSpentSeconds || 0), 0);
        const firstTry = logs.filter(l => l.mistakeCount === 0).length;
        return {
          count: count,
          avgSec: Math.round(totalSec / count),
          firstTryCount: firstTry,
          accuracy: Math.round((firstTry / count) * 100),
          totalMinutes: Math.round((totalSec / 60) * 10) / 10
        };
      };

      const todayStats = calcStats(todayLogs);
      const pastStats = calcStats(pastLogs);

      // 🌟 オフラインファースト＆スプレッドシート最優先のハイブリッド集計
      // スプレッドシート由来のサマリー（確定値）が存在する場合はスプレッドシートを最優先（正）とし、
      // まだスプレッドシートに送信できていない未送信ログのみを加算してリアルタイム反映する（巻き戻り防止）
      const unsyncedLogs = this.getUnsyncedLogsForUser(userInfo);
      const unsyncedCount = unsyncedLogs.length;
      const unsyncedSec = unsyncedLogs.reduce((sum, l) => sum + (l.timeSpentSeconds || 0), 0);

      const user = userInfo || this.currentUser;
      const uKey = (user && user.studentNumber)
        ? `${this.normalizeClassName(user.className)}_${user.studentNumber}`
        : 'default';
      if (!this.solvedWatermarks) this.solvedWatermarks = {};
      if (!this.minuteWatermarks) this.minuteWatermarks = {};

      let calculatedSolved = 0;
      let calculatedMinutes = 0;

      if (userInfo && userInfo.summary && (userInfo.summary.totalSolved !== undefined && userInfo.summary.totalSolved !== null)) {
        const s = userInfo.summary;
        const remoteSolved = Number(s.totalSolved) || 0;
        const remoteMinutes = Number(s.totalMinutes) || 0;

        // 通算正解数 = スプレッドシート確定値 ＋ 未送信ログ数
        // かつ、少なくとも「今日この端末で解いた数（todayStats.count）」を下回ることは絶対にない！
        calculatedSolved = Math.max(remoteSolved + unsyncedCount, todayStats.count);
        calculatedMinutes = Math.max(
          Math.round((remoteMinutes + (unsyncedSec / 60)) * 10) / 10,
          todayStats.totalMinutes
        );

        // 通算打率・スイング速度もスプレッドシートの値を最優先（マスター）とする
        if (s.accuracy !== null && s.accuracy !== undefined) {
          pastStats.accuracy = Number(s.accuracy);
        }
        if (s.avgSeconds !== null && s.avgSeconds !== undefined) {
          pastStats.avgSec = Number(s.avgSeconds);
        }
        pastStats.count = remoteSolved;
        pastStats.totalMinutes = remoteMinutes;
      } else {
        // スプレッドシート側に名簿がない場合（新規登録、またはスプレッドシート側で削除された児童）でも、
        // 今日解いた正解数は確実にリアルタイム即時反映！
        calculatedSolved = todayStats.count;
        calculatedMinutes = todayStats.totalMinutes;
        pastStats.count = 0;
        pastStats.totalMinutes = 0;
      }

      // 💥【リアルタイム即時更新＆単調増加ウォーターマーク保証】
      // 正解した瞬間に加算された値や過去の最高正解数を決して下回らない
      // （送信完了時の一時的な未反映・再フェッチ待ちでも絶対に巻き戻らない！）
      const watermarkSolved = this.solvedWatermarks[uKey] || 0;
      const totalKnocksDone = Math.max(calculatedSolved, watermarkSolved);
      this.solvedWatermarks[uKey] = totalKnocksDone;

      const watermarkMinutes = this.minuteWatermarks[uKey] || 0;
      const combinedTotalMinutes = Math.max(calculatedMinutes, watermarkMinutes);
      this.minuteWatermarks[uKey] = combinedTotalMinutes;

      // 1000本ノックのカウントダウン＆カウントアップ計算
      const target = this.targetKnocks;
      const isCompleted = totalKnocksDone >= target;
      const remainingKnocks = Math.max(0, target - totalKnocksDone);
      const extraKnocks = isCompleted ? (totalKnocksDone - target) : 0;
      const knockProgressPercent = Math.min(100, Math.round((totalKnocksDone / target) * 100));

      // スピード変化（スイング速度の短縮差分）
      let speedDiff = null;
      if (todayStats.count > 0 && pastStats.count > 0) {
        speedDiff = pastStats.avgSec - todayStats.avgSec;
      }

      // 打率変化（正答率差分）
      let accDiff = null;
      if (todayStats.count > 0 && pastStats.count > 0) {
        accDiff = todayStats.accuracy - pastStats.accuracy;
      }

      return {
        today: {
          ...todayStats,
          activeSeconds: this.activeSeconds,
          todayMinutes: Math.floor(this.activeSeconds / 60)
        },
        past: pastStats,
        all: {
          count: totalKnocksDone,
          totalMinutes: combinedTotalMinutes
        },
        knocks: {
          target: target,
          done: totalKnocksDone,
          remaining: remainingKnocks,
          isCompleted: isCompleted,
          extra: extraKnocks,
          percent: knockProgressPercent
        },
        speedDiff: speedDiff,
        accDiff: accDiff
      };
    }

    clearLogs() {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY_LOGS);
        localStorage.removeItem(STORAGE_KEY_SESSION);
      }
      this.activeSeconds = 0;
      this.targetReachedFired = false;
    }
  }

  return StudyTracker;
});
