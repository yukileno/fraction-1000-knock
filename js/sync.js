/**
 * Googleスプレッドシート自動同期マネージャー
 * 1分に1回の自動同期 ＋ 手動保存ボタン ＋ オフラインキュー
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.SheetSync = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwUudBJc13ECSV4Bz92IgQ_0e2i5Lx7bEPIp4r1oXQcbWW5XTMKlNAyplnbx5wxXKE/exec';
  const STORAGE_KEY_GAS_URL = 'keisan_gas_webhook_url_v1';
  const STORAGE_KEY_LOGS = 'keisan_problem_logs_v1';

  class SheetSync {
    constructor(options = {}) {
      const saved = localStorage.getItem(STORAGE_KEY_GAS_URL);
      this.gasUrl = (saved !== null && saved !== undefined) ? saved : DEFAULT_GAS_URL;

      this.onStatusChange = options.onStatusChange || (() => {});
      this.onSyncSuccess = options.onSyncSuccess || (() => {});
      this.autoSyncIntervalMs = 60 * 1000; // 1分に1回
      this.isSyncing = false;
      this.lastSyncTime = null;
      this.timerId = null;

      this.startAutoSync();
      this.setupOnlineListener();
    }

    setupOnlineListener() {
      if (typeof window !== 'undefined') {
        window.addEventListener('online', async () => {
          const unsynced = this.getUnsyncedLogs();
          if (unsynced.length > 0) {
            console.log(`[SheetSync] 📶 ネット復帰検知: 未送信ログ ${unsynced.length} 件をスプレッドシートへ自動送信します (Push先行)`);
            await this.syncNow(false);
          }
        });
      }
    }

    setUrl(url) {
      this.gasUrl = (url || '').trim();
      localStorage.setItem(STORAGE_KEY_GAS_URL, this.gasUrl);
      this.checkAndNotify();
    }

    getUrl() {
      return this.gasUrl;
    }

    startAutoSync() {
      if (this.timerId) clearInterval(this.timerId);
      this.timerId = setInterval(() => {
        const unsynced = this.getUnsyncedLogs();
        if (unsynced.length > 0) {
          this.syncNow(false);
        }
      }, this.autoSyncIntervalMs);
    }

    getUnsyncedLogs() {
      try {
        const logs = JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]');
        return logs.filter(l => !l.syncedToSheet);
      } catch (e) {
        return [];
      }
    }

    markLogsAsSynced(logIds) {
      try {
        const logs = JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]');
        const idSet = new Set(logIds);
        logs.forEach(l => {
          if (idSet.has(l.id)) {
            l.syncedToSheet = true;
          }
        });
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
      } catch (e) {
        console.error('Failed to mark logs as synced:', e);
      }
    }

    // 状態をチェックしてUIに通知
    checkAndNotify() {
      if (this.isSyncing) {
        this.notify('saving', this.getUnsyncedLogs().length);
        return;
      }
      const unsynced = this.getUnsyncedLogs();
      if (unsynced.length > 0) {
        this.notify('unsaved', unsynced.length);
      } else {
        this.notify('saved', 0);
      }
    }

    // 同期実行
    async syncNow(isManual = false) {
      if (this.isSyncing) return { status: 'already_syncing' };

      const unsynced = this.getUnsyncedLogs();
      if (!this.gasUrl) {
        this.notify('no_url', unsynced.length);
        return { status: 'no_url', count: unsynced.length };
      }

      if (unsynced.length === 0) {
        this.notify('saved', 0);
        return { status: 'saved', count: 0 };
      }

      this.isSyncing = true;
      this.notify('saving', unsynced.length);

      const payload = {
        action: 'save_logs',
        clientTimestamp: new Date().toISOString(),
        logs: unsynced.map(l => ({
          id: l.id,
          sessionId: l.sessionId,
          className: l.className || '',
          studentNumber: l.studentNumber || '',
          nickname: l.nickname || '',
          studentName: l.studentName || '児童',
          timestamp: l.timestamp,
          formula: l.problem ? l.problem.formula : '',
          op: l.problem ? l.problem.op : '',
          category: l.problem ? l.problem.category : '',
          correctAnswer: l.problem ? l.problem.correctAnswer : '',
          timeSpentSeconds: l.timeSpentSeconds || 0,
          mistakeCount: l.mistakeCount || 0,
          level: (l.problem && l.problem.level !== undefined && l.problem.level !== null) ? l.problem.level : '',
          kind: (l.problem && l.problem.kind) || '',
          revealed: Boolean(l.revealed)
        }))
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(this.gasUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timer);

        // GASが保存成功を返した場合のみ送信済みにする（失敗時は未送信のまま残して次回再送）
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const result = await res.json();
        if (!result || result.status !== 'success') {
          throw new Error((result && result.message) || 'スプレッドシートへの保存に失敗しました');
        }

        const syncedIds = unsynced.map(l => l.id);
        this.markLogsAsSynced(syncedIds);
        this.lastSyncTime = new Date();
        this.isSyncing = false;

        this.notify('saved', 0);

        try {
          if (typeof this.onSyncSuccess === 'function') {
            this.onSyncSuccess({ count: syncedIds.length, isManual });
          }
        } catch (cbErr) {
          console.warn('Error in onSyncSuccess callback:', cbErr);
        }

        return { status: 'success', count: syncedIds.length };
      } catch (err) {
        clearTimeout(timer);
        console.warn('Sync failed (offline or network issue):', err);
        this.isSyncing = false;
        this.notify('error', unsynced.length, err.message);
        return { status: 'error', error: err.message, count: unsynced.length };
      }
    }

    // 🌟 送信先行型同期（Push-then-Pull）
    // まず未送信ログをスプレッドシートへ送信（Push）。送信成功（または未送信なし）の後に最新名簿（Pull）を取得して返す。
    // オフライン等で未送信の送信が失敗した場合は、古いデータで上書きしないようPullをスキップする。
    async pushThenPull(timeoutMs = 8000) {
      const unsynced = this.getUnsyncedLogs();
      if (unsynced.length > 0) {
        const pushRes = await this.syncNow(false);
        if (pushRes.status === 'error') {
          return { status: 'push_failed', error: pushRes.error };
        }
      }
      const users = await this.fetchUsersFromSheet(timeoutMs);
      return { status: 'success', users: users };
    }

    // ユーザー名簿の同期（名前登録時）
    async syncUser(user) {
      if (!this.gasUrl || !user) return;
      try {
        await fetch(this.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'sync_user',
            user: {
              className: user.className,
              studentNumber: user.studentNumber,
              nickname: user.nickname,
              updatedAt: new Date().toISOString()
            }
          })
        });
      } catch (e) {
        console.warn('Failed to sync user to sheet:', e);
      }
    }

    // 📖 スプレッドシートから全児童の名簿データを読み込む（通信成功時は配列、失敗時はnull）
    async fetchUsersFromSheet(timeoutMs = 12000) {
      if (!this.gasUrl) return null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const fetchUrl = `${this.gasUrl}${this.gasUrl.includes('?') ? '&' : '?'}action=get_users&t=${Date.now()}`;
        const res = await fetch(fetchUrl, {
          signal: controller.signal,
          mode: 'cors'
        });
        clearTimeout(timer);

        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.users)) {
          return data.users;
        }
        return null;
      } catch (err) {
        console.warn('Failed to fetch users from sheet (timeout or network):', err);
        return null;
      }
    }

    // 📖 スプレッドシートから指定児童の学習サマリーを読み込む
    async fetchStudentSummary(className, studentNumber, dateStr = null) {
      if (!this.gasUrl) return null;
      try {
        let fetchUrl = `${this.gasUrl}${this.gasUrl.includes('?') ? '&' : '?'}action=get_student_summary&class=${encodeURIComponent(className)}&number=${encodeURIComponent(studentNumber)}&t=${Date.now()}`;
        if (dateStr) {
          fetchUrl += `&date=${encodeURIComponent(dateStr)}`;
        }
        const res = await fetch(fetchUrl);
        const data = await res.json();
        if (data.status === 'success' && data.summary) {
          return data.summary;
        }
        return null;
      } catch (err) {
        console.warn('Failed to fetch student summary from sheet:', err);
        return null;
      }
    }

    notify(state, count = 0, errMsg = '') {
      this.onStatusChange({
        state,
        count,
        lastSyncTime: this.lastSyncTime,
        errorMessage: errMsg
      });
    }
  }

  return SheetSync;
});

