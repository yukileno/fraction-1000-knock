/**
 * 児童アカウント・ログイン管理モジュール (パスワードなし・毎回ログイン版)
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.AuthManager = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const STORAGE_KEY_REGISTRY = 'keisan_student_registry_v2';

  class AuthManager {
    constructor() {
      this.currentUser = null; // 毎回ログインを求めるため初期値は常にnull
    }

    // 保存されている名簿辞書 { "5年1組-12": "たろう", ... }
    getRegistry() {
      if (typeof localStorage === 'undefined') return this._mockRegistry || {};
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_REGISTRY) || '{}');
      } catch (e) {
        return {};
      }
    }

    saveRegistry(reg) {
      if (typeof localStorage === 'undefined') {
        this._mockRegistry = reg;
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY_REGISTRY, JSON.stringify(reg));
      } catch (e) {
        console.error('Failed to save student registry:', e);
      }
    }

    makeKey(className, number) {
      // 「5年1組」「1組」「1」などの表記揺れを吸収し、統一キーを生成
      const str = String(className || '').trim();
      const match = str.match(/(\d+)\s*組?/);
      const classNum = match ? match[1] : str;
      return `組${classNum}-番${Number(number)}`;
    }

    // スプレッドシートから読み込んだ名簿を取り込む（スプレッドシートを完全マスターとし、削除も完全反映）
    syncWithRemoteUsers(users) {
      if (!Array.isArray(users)) return;

      // 🌟 スプレッドシート側の名簿でローカルレジストリを完全再構築！
      // （スプレッドシート側で削除・初期化された児童は、ローカルからも完全に消去される）
      const newRegistry = {};

      users.forEach(u => {
        if (u.className && u.studentNumber && u.nickname) {
          const key = this.makeKey(u.className, u.studentNumber);
          newRegistry[key] = {
            className: u.className,
            studentNumber: Number(u.studentNumber),
            nickname: u.nickname,
            totalSolved: Number(u.totalSolved) || 0,
            totalMinutes: Number(u.totalMinutes) || 0,
            accuracy: (u.accuracy !== undefined && u.accuracy !== null) ? Number(u.accuracy) : null,
            avgSeconds: (u.avgSeconds !== undefined && u.avgSeconds !== null) ? Number(u.avgSeconds) : null,
            totalMistakes: Number(u.totalMistakes) || 0,
            lastStudyAt: u.lastStudyAt || ''
          };
        }
      });

      this.saveRegistry(newRegistry);

      // ログイン中のユーザーがいれば、スプレッドシートの最新サマリー・名前に即時更新
      if (this.currentUser) {
        const myKey = this.makeKey(this.currentUser.className, this.currentUser.studentNumber);
        if (newRegistry[myKey]) {
          this.currentUser.summary = newRegistry[myKey];
          if (newRegistry[myKey].nickname) {
            this.currentUser.nickname = newRegistry[myKey].nickname;
            this.currentUser.displayName = `${this.currentUser.className} ${this.currentUser.studentNumber}番 ${this.currentUser.nickname}`;
          }
        } else {
          // スプレッドシート側で名簿から消去されていた場合はサマリーをクリア
          this.currentUser.summary = null;
        }
      }
    }

    // 児童の登録状態を確認
    checkStudent(className, number) {
      const key = this.makeKey(className, number);
      const registry = this.getRegistry();
      const val = registry[key];

      if (val) {
        const nickname = typeof val === 'object' ? val.nickname : val;
        const summary = typeof val === 'object' ? val : null;
        return {
          exists: true,
          className: className,
          studentNumber: Number(number),
          nickname: nickname,
          summary: summary
        };
      }
      return {
        exists: false,
        className: className,
        studentNumber: Number(number),
        nickname: '',
        summary: null
      };
    }

    // 名前を登録または更新してログイン
    loginWithNickname(className, number, nickname) {
      const cleanNick = (nickname || '').trim();
      const key = this.makeKey(className, number);
      const registry = this.getRegistry();

      const existing = (typeof registry[key] === 'object' && registry[key] !== null)
        ? registry[key]
        : { totalSolved: 0, totalMinutes: 0, accuracy: null, avgSeconds: null, totalMistakes: 0, lastStudyAt: '' };
      existing.className = className;
      existing.studentNumber = Number(number);
      existing.nickname = cleanNick;
      registry[key] = existing;
      this.saveRegistry(registry);

      const user = {
        className: className,
        studentNumber: Number(number),
        nickname: cleanNick,
        displayName: `${className} ${number}番 ${cleanNick}`,
        summary: existing
      };

      this.currentUser = user;
      return user;
    }

    // 登録済みの名前でそのままログイン
    loginExisting(className, number) {
      const checked = this.checkStudent(className, number);
      if (!checked.exists) return null;

      const user = {
        className: className,
        studentNumber: Number(number),
        nickname: checked.nickname,
        displayName: `${className} ${number}番 ${checked.nickname}`,
        summary: checked.summary
      };

      this.currentUser = user;
      return user;
    }

    // 登録されている全児童のニックネーム一覧を取得（自分を除外可能）
    getAllRegisteredNicknames(excludeNickname = '') {
      const reg = this.getRegistry();
      const names = [];
      const exclude = String(excludeNickname || '').trim();

      Object.keys(reg).forEach(key => {
        const val = reg[key];
        const nick = (typeof val === 'object' && val !== null ? val.nickname : val) || '';
        const clean = String(nick).trim();
        if (clean && clean !== exclude && !names.includes(clean)) {
          names.push(clean);
        }
      });

      return names;
    }

    // 🏆 ランキング用の全児童リストを取得（ローカルキャッシュから即時復元）
    getAllUsersForRanking() {
      const reg = this.getRegistry();
      const list = [];
      Object.keys(reg).forEach(key => {
        const val = reg[key];
        if (!val) return;
        const nickname = typeof val === 'object' ? val.nickname : val;
        // キーからクラスと番号をパース (フォールバック用)
        let className = (typeof val === 'object' && val.className) ? val.className : '';
        let studentNumber = (typeof val === 'object' && val.studentNumber) ? Number(val.studentNumber) : 0;
        if (!className || !studentNumber) {
          const match = key.match(/組(\d+)-番(\d+)/);
          if (match) {
            if (!className) className = `5年${match[1]}組`;
            if (!studentNumber) studentNumber = Number(match[2]);
          }
        }
        const totalSolved = (typeof val === 'object' && val.totalSolved !== undefined) ? Number(val.totalSolved) : 0;
        const totalMinutes = (typeof val === 'object' && val.totalMinutes !== undefined) ? Number(val.totalMinutes) : 0;
        const accuracy = (typeof val === 'object' && val.accuracy !== undefined && val.accuracy !== null) ? Number(val.accuracy) : null;
        const avgSeconds = (typeof val === 'object' && val.avgSeconds !== undefined && val.avgSeconds !== null) ? Number(val.avgSeconds) : null;
        const totalMistakes = (typeof val === 'object' && val.totalMistakes !== undefined) ? Number(val.totalMistakes) : 0;
        const lastStudyAt = (typeof val === 'object' && val.lastStudyAt) ? val.lastStudyAt : '';

        list.push({
          className: className,
          studentNumber: studentNumber,
          nickname: nickname || '',
          totalSolved: totalSolved,
          totalMinutes: totalMinutes,
          accuracy: accuracy,
          avgSeconds: avgSeconds,
          totalMistakes: totalMistakes,
          lastStudyAt: lastStudyAt
        });
      });
      return list;
    }

    getCurrentUser() {
      return this.currentUser;
    }

    isLoggedIn() {
      return Boolean(this.currentUser);
    }

    logout() {
      this.currentUser = null;
    }
  }

  return AuthManager;
});
