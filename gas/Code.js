/**
 * 小学5年 分数計算30分ドリル バックエンド (GAS)
 * - 学習ログ記録（時系列原本ログ）
 * - 児童名簿管理（最新サマリー自動集計＆名簿同期）
 * - 「日別集計」ダッシュボード自動生成
 * - 「研究用_学習曲線」分析シート自動生成
 */

// スプレッドシートを開いた時のカスタムメニュー
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📐 分数ドリル管理')
    .addItem('🛠️ 「計算ドリル記録」のヘッダー＆正解日付化バグを一括修復', 'menuFixLogSheet')
    .addItem('⚡ 「児童名簿」に自動計算式を一括設定（高速化・推奨）', 'applyUserSheetFormulas')
    .addItem('👥 「児童名簿」の累計実績を全再集計', 'recalculateAllUserSummaries')
    .addItem('🧹 「計算ドリル記録」の重複ログを削除', 'menuDeduplicateLogs')
    .addItem('📊 「日別集計」シートを再構築', 'setupDailySummarySheet')
    .addItem('📈 「研究用_学習曲線」シートを再構築', 'setupResearchSheet')
    .addItem('🔄 集計シートの数式だけを最新に更新（選択・グラフはそのまま）', 'refreshAnalysisSheets')
    .addSeparator()
    .addItem('📈 グラフを「左右2軸（折れ線＋折れ線）」に変更', 'menuUpdateChartLine')
    .addItem('📊 グラフを「左右2軸（折れ線＋赤棒グラフ）」に変更', 'menuUpdateChartCombo')
    .addToUi();
}

function menuUpdateChartLine() {
  var res = updateResearchChart('line');
  SpreadsheetApp.getUi().alert('グラフを「左右2軸（折れ線＋折れ線）」に更新しました！\n左軸：所要時間(秒)\n右軸：間違えた回数(回)');
}

function menuUpdateChartCombo() {
  var res = updateResearchChart('combo');
  SpreadsheetApp.getUi().alert('グラフを「左右2軸（折れ線＋棒グラフ）」に更新しました！\n左軸：所要時間(秒) [折れ線]\n右軸：間違えた回数(回) [赤棒グラフ]');
}

function menuDeduplicateLogs() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var res = deduplicateLogSheet(SpreadsheetApp.getActiveSpreadsheet());
    SpreadsheetApp.getUi().alert('重複ログの削除が完了しました。\n\n削除: ' + res.deletedCount + ' 行\n残り: ' + res.remainingRows + ' 行');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 「計算ドリル記録」の重複行を削除する（呼び出し側で LockService のロックを取得しておくこと）
 * ログIDがある行はIDが同じものだけを重複とみなす（同じ問題を解き直した正当な記録は残す）
 */
function deduplicateLogSheet(ss) {
  var lSheet = ss.getSheetByName('計算ドリル記録');
  var deletedRows = 0;
  if (lSheet) {
    var lastRow = lSheet.getLastRow();
    if (lastRow > 1) {
      var allValues = lSheet.getRange(2, 1, lastRow - 1, LOG_COLS).getValues();
      var seenMap = {};
      var uniqueRows = [];

      for (var i = 0; i < allValues.length; i++) {
        var r = allValues[i];
        var key = r[12] ? 'id:' + r[12] : legacyLogKey(r[1], r[2], r[10], r[4], r[7]);
        if (!seenMap[key]) {
          seenMap[key] = true;
          uniqueRows.push(r);
        } else {
          deletedRows++;
        }
      }

      if (deletedRows > 0) {
        // 2行目以降の全データをクリアして、ユニーク行だけを一括書き戻し！
        lSheet.getRange(2, 1, lastRow - 1, LOG_COLS).clearContent();
        lSheet.getRange(2, 1, uniqueRows.length, LOG_COLS).setValues(uniqueRows);
        // 余分な行を末尾から一括削除
        if (lastRow > uniqueRows.length + 1) {
          var extraRows = lastRow - (uniqueRows.length + 1);
          lSheet.deleteRows(uniqueRows.length + 2, extraRows);
        }
        // A列の書式と列幅を再適用
        lSheet.getRange('A2:A' + (uniqueRows.length + 1)).setNumberFormat('yyyy-MM-dd HH:mm:ss');
        lSheet.setColumnWidth(1, 165);
      }
    }
  }
  return { deletedCount: deletedRows, remainingRows: lSheet ? lSheet.getLastRow() : 0 };
}

function menuFixLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = fixLogSheetData(ss);
  SpreadsheetApp.getUi().alert('「計算ドリル記録」シートの修復が完了しました！\n\nヘッダーを正しい16項目に更新し、日付化していた正解データを ' + res.fixedCount + ' 件修復しました。');
}

// 「計算ドリル記録」の列数（A〜P）。M列 = ログID（端末で採番される一意ID。再送時の重複判定に使用）
// N列 = 出題段階(0〜8)、O列 = 種別(計測球/練習球)、P列 = 答え表示（規定回数ミスで答えを見せて次へ進んだ）
var LOG_COLS = 16;
var LOG_ID_COL = 13;

// 旧形式（ログIDなし）の行に使う重複判定キー: クラス|番号|セッション|問題式|正解
function legacyLogKey(className, studentNumber, sessionId, formula, answer) {
  return [className || '', studentNumber ? Number(studentNumber) : '', sessionId || '',
    String(formula || '').replace(/^'/, '').trim(), String(answer || '').replace(/^'/, '').trim()].join('|');
}

function doPost(e) {
  // 同時書き込みで getLastRow() が競合し、行が上書きされるのを防ぐ
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (lockErr) {
    // ロック取得失敗は error を返す → 端末側は未送信のまま残し、次回自動で再送する
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'サーバー混雑中のため保存できませんでした（自動で再送します）'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 学習ログの保存（ログIDで重複排除して追記）
    if (data.action === 'save_logs' && data.logs && data.logs.length > 0) {
      var logSheet = getOrCreateLogSheet(ss);
      var lastRow = logSheet.getLastRow();

      // 既存のログID一覧（再送された同じログを弾く）
      var existingIds = {};
      // ログIDを持たない旧クライアント向け: 直近50行の旧キー
      var recentLegacySet = {};
      if (lastRow > 1) {
        var idValues = logSheet.getRange(2, LOG_ID_COL, lastRow - 1, 1).getValues();
        for (var iv = 0; iv < idValues.length; iv++) {
          if (idValues[iv][0]) existingIds[String(idValues[iv][0])] = true;
        }
        var checkCount = Math.min(50, lastRow - 1);
        var checkStart = lastRow - checkCount + 1;
        var existingRecent = logSheet.getRange(checkStart, 1, checkCount, 12).getValues();
        for (var er = 0; er < existingRecent.length; er++) {
          var rVal = existingRecent[er];
          recentLegacySet[legacyLogKey(rVal[1], rVal[2], rVal[10], rVal[4], rVal[7])] = true;
        }
      }

      var rows = [];
      var seenInPayload = {};

      for (var i = 0; i < data.logs.length; i++) {
        var log = data.logs[i];
        var d = new Date(log.timestamp);
        var dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
        var formulaStr = String(log.formula || '').trim();
        var answerStr = String(log.correctAnswer || '').trim();
        var sId = String(log.sessionId || '').trim();
        var logId = String(log.id || '').trim();

        // 重複判定: ログIDがあればIDで判定（同じ問題を別の機会に解いた正当な記録は残す）
        var dupKey = logId
          ? 'id:' + logId
          : legacyLogKey(log.className, log.studentNumber, sId, formulaStr, answerStr);
        if (seenInPayload[dupKey] || (logId ? existingIds[logId] : recentLegacySet[dupKey])) {
          continue;
        }
        seenInPayload[dupKey] = true;

        rows.push([
          d,                                                  // A: 記録日時
          log.className || '',                               // B: クラス
          log.studentNumber ? Number(log.studentNumber) : '', // C: 出席番号
          log.nickname || log.studentName || '児童',           // D: ニックネーム
          "'" + formulaStr,                                  // E: 問題式 (日付自動変換防止)
          log.op || '',                                      // F: 演算
          log.category || '',                                // G: 単元分類
          "'" + answerStr,                                   // H: 正解 (7/8等が日付になるのを完全防止)
          log.timeSpentSeconds || 0,                         // I: 所要時間(秒)
          log.mistakeCount || 0,                             // J: 間違えた回数
          sId,                                               // K: セッションID
          "'" + dateStr,                                     // L: 日付 (YYYY-MM-DD)
          logId,                                             // M: ログID
          (log.level === '' || log.level === undefined || log.level === null) ? '' : Number(log.level), // N: 出題段階
          log.kind === 'probe' ? '計測球' : (log.kind === 'practice' ? '練習球' : ''),              // O: 種別
          log.revealed ? '答え表示' : ''                                                           // P: 答え表示
        ]);
      }

      if (rows.length > 0) {
        lastRow = logSheet.getLastRow();
        logSheet.getRange(lastRow + 1, 1, rows.length, LOG_COLS).setValues(rows);
        // A列に明示的に日時書式（時分秒まで）を適用して時間表示を保証！
        logSheet.getRange(lastRow + 1, 1, rows.length, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        savedCount: rows.length,
        skippedDuplicates: data.logs.length - rows.length
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 児童名簿の保存（名前登録・更新時）
    if (data.action === 'sync_user' && data.user) {
      var userSheet = getOrCreateUserSheet(ss);
      var u = data.user;
      var dataRange = userSheet.getDataRange().getValues();
      var foundRowIndex = -1;

      for (var r = 1; r < dataRange.length; r++) {
        if (dataRange[r][1] == u.className && dataRange[r][2] == u.studentNumber) {
          foundRowIndex = r + 1;
          break;
        }
      }

      if (foundRowIndex > 0) {
        // 既存行の場合、A列（更新日時）とD列（ニックネーム）のみ更新（累計値は保持）
        userSheet.getRange(foundRowIndex, 1).setValue(new Date());
        userSheet.getRange(foundRowIndex, 4).setValue(u.nickname);
      } else {
        // 新規児童行の追加（自動計算式を直接設定！）
        var newRow = userSheet.getLastRow() + 1;
        userSheet.appendRow([
          new Date(),
          u.className,
          Number(u.studentNumber),
          u.nickname
        ].concat(userRowFormulas(newRow)));
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        action: 'user_synced'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'ignored',
      message: 'Unknown action'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// 児童用アプリが使う読み取り専用の action 以外（調査・修復・削除系）は管理者専用
var ADMIN_ACTIONS = [
  'inspect_sheets', 'fix_sheets', 'setup_research', 'setup_daily', 'apply_formulas',
  'clean_test_rows', 'find_duplicates', 'deduplicate_logs', 'inspect_research',
  'update_research_chart', 'inspect_daily', 'learning_stats', 'refresh_sheets'
];

/**
 * 📊 難易度設計のための学習状況集計（ニックネーム・個々のログは含めない）
 * - 単元の要素（真分数/帯分数 × 足し算/引き算 × 繰り上がり・下がり × 約分）別の成績
 * - 児童別（クラス・番号のみ）の真分数と帯分数の成績差、序盤→直近の伸び
 * - 通算何問目かの区間別の学習曲線
 * 教師用(45番)とテストセッション(test_)は除外
 */
function computeLearningStats(ss) {
  var sheet = ss.getSheetByName('計算ドリル記録');
  if (!sheet || sheet.getLastRow() <= 1) return { status: 'success', totalRows: 0 };
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();

  function newAgg() { return { n: 0, first: 0, sec: 0, mis: 0, hard: 0, secs: [] }; }
  function add(a, sec, mis) {
    a.n++; a.sec += sec; a.mis += mis; a.secs.push(sec);
    if (mis === 0) a.first++;
    if (mis >= 3) a.hard++;
  }
  function fin(a) {
    if (!a || a.n === 0) return { n: 0 };
    var s = a.secs.slice().sort(function (x, y) { return x - y; });
    return {
      n: a.n,
      firstTryRate: Math.round(a.first / a.n * 1000) / 10,   // 1発正解率(%)
      avgSec: Math.round(a.sec / a.n * 10) / 10,
      medianSec: s[Math.floor(s.length / 2)],
      avgMistakes: Math.round(a.mis / a.n * 100) / 100,
      mistakes3PlusRate: Math.round(a.hard / a.n * 1000) / 10 // 3回以上空振りした問題の割合(%)
    };
  }
  function features(cat) {
    cat = String(cat || '');
    return {
      mixed: cat.indexOf('帯分数') !== -1,
      op: cat.indexOf('引き算') !== -1 ? '-' : '+',
      regroup: cat.indexOf('繰り上がりあり') !== -1 || cat.indexOf('繰り下がりあり') !== -1,
      reduce: cat.indexOf('約分') !== -1
    };
  }

  var byCategory = {}, byFeature = {}, students = {}, curve = {};
  var used = 0, excluded = 0;
  var dateMin = null, dateMax = null;

  // 児童ごとに時系列で「通算何問目か」を数えるため、日時順に処理
  values.sort(function (a, b) { return new Date(a[0]) - new Date(b[0]); });

  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var cls = String(r[1] || '').trim();
    var num = Number(r[2]);
    var sid = String(r[10] || '');
    if (!cls || !num || num === 45 || sid.indexOf('test_') === 0) { excluded++; continue; }
    var sec = Number(r[8]) || 0;
    var mis = Number(r[9]) || 0;
    var cat = String(r[6] || '');
    var f = features(cat);
    used++;
    var d = new Date(r[0]);
    if (!isNaN(d)) {
      if (!dateMin || d < dateMin) dateMin = d;
      if (!dateMax || d > dateMax) dateMax = d;
    }

    if (!byCategory[cat]) byCategory[cat] = newAgg();
    add(byCategory[cat], sec, mis);

    var fKey = (f.mixed ? '帯分数' : '真分数') + (f.op === '+' ? '・足し算' : '・引き算') +
      (f.regroup ? '・繰り上がり/下がりあり' : '') + (f.reduce ? '・約分あり' : '');
    if (!byFeature[fKey]) byFeature[fKey] = newAgg();
    add(byFeature[fKey], sec, mis);

    var sKey = cls + '_' + num;
    if (!students[sKey]) students[sKey] = { cls: cls, num: num, count: 0, all: newAgg(), proper: newAgg(), mixed: newAgg(), mixedRegroup: newAgg(), mixedSeq: [] };
    var st = students[sKey];
    st.count++;
    add(st.all, sec, mis);
    add(f.mixed ? st.mixed : st.proper, sec, mis);
    if (f.mixed && f.regroup) add(st.mixedRegroup, sec, mis);
    if (f.mixed) st.mixedSeq.push([sec, mis]);

    // 学習曲線: 通算問題数の区間 × 真分数/帯分数
    var bin = st.count <= 20 ? '001-020' : st.count <= 50 ? '021-050' : st.count <= 100 ? '051-100' :
      st.count <= 200 ? '101-200' : st.count <= 400 ? '201-400' : '401+';
    var cKey = bin + (f.mixed ? '_帯分数' : '_真分数');
    if (!curve[cKey]) curve[cKey] = newAgg();
    add(curve[cKey], sec, mis);
  }

  function finMap(m) { var o = {}; for (var k in m) o[k] = fin(m[k]); return o; }

  var studentList = [];
  for (var k in students) {
    var s = students[k];
    // 帯分数の序盤20問と直近20問の比較（伸び）
    var early = newAgg(), late = newAgg();
    var seq = s.mixedSeq;
    for (var e = 0; e < Math.min(20, seq.length); e++) add(early, seq[e][0], seq[e][1]);
    for (var l = Math.max(0, seq.length - 20); l < seq.length; l++) add(late, seq[l][0], seq[l][1]);
    studentList.push({
      student: s.cls + ' ' + s.num + '番',
      total: s.count,
      all: fin(s.all),
      proper: fin(s.proper),
      mixed: fin(s.mixed),
      mixedRegroup: fin(s.mixedRegroup),
      mixedEarly20: seq.length >= 40 ? fin(early) : null,
      mixedLate20: seq.length >= 40 ? fin(late) : null
    });
  }
  studentList.sort(function (a, b) { return b.total - a.total; });

  return {
    status: 'success',
    totalRows: values.length,
    usedRows: used,
    excludedRows: excluded,
    period: {
      from: dateMin ? Utilities.formatDate(dateMin, 'Asia/Tokyo', 'yyyy-MM-dd') : '',
      to: dateMax ? Utilities.formatDate(dateMax, 'Asia/Tokyo', 'yyyy-MM-dd') : ''
    },
    byCategory: finMap(byCategory),
    byFeature: finMap(byFeature),
    learningCurve: finMap(curve),
    students: studentList
  };
}

/**
 * 管理者リクエストの判定。
 * スクリプトプロパティ ADMIN_TOKEN（GASエディタ > プロジェクトの設定 > スクリプト プロパティ）に
 * 推測されにくい文字列を設定し、?action=...&token=<その文字列> で呼び出す。
 * ADMIN_TOKEN が未設定の間は管理者用 action はすべて拒否される（スプレッドシートのメニューからは実行可能）。
 */
function isAdminRequest_(e) {
  var token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  var given = (e && e.parameter && e.parameter.token) ? String(e.parameter.token) : '';
  return !!token && given === token;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'status';
  if (ADMIN_ACTIONS.indexOf(action) === -1) {
    return handleGet_(e);
  }

  if (!isAdminRequest_(e)) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'forbidden',
      message: 'この操作には管理者トークンが必要です。'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 修復・削除系は児童の保存(doPost)と同時に走るとデータを壊すため、同じロックで直列化する
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (lockErr) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'ロックを取得できませんでした。時間をおいて再実行してください。'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    return handleGet_(e);
  } finally {
    lock.releaseLock();
  }
}

function handleGet_(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'status';

    // 1. 児童名簿の取得 (名前自動補完 ＆ 過去累計サマリー読込)
    if (action === 'get_users') {
      var userSheet = getOrCreateUserSheet(ss);
      var users = [];
      if (userSheet) {
        // E〜J列に関数が未設定の行があれば自動修復・適用
        ensureUserSheetFormulas(userSheet);

        var values = userSheet.getDataRange().getValues();
        // 1行目はヘッダー
        for (var i = 1; i < values.length; i++) {
          var row = values[i];
          if (row[1] && row[2]) {
            var lastDateStr = '';
            if (row[9]) {
              try {
                lastDateStr = row[9] instanceof Date
                  ? Utilities.formatDate(row[9], 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')
                  : String(row[9]);
              } catch(e) {}
            }
            users.push({
              className: String(row[1]),
              studentNumber: Number(row[2]),
              nickname: String(row[3] || ''),
              totalSolved: Number(row[4]) || 0,
              totalMinutes: Number(row[5]) || 0,
              accuracy: (row[6] !== '' && !isNaN(row[6])) ? Number(row[6]) : null,
              avgSeconds: (row[7] !== '' && !isNaN(row[7])) ? Number(row[7]) : null,
              totalMistakes: Number(row[8]) || 0,
              lastStudyAt: lastDateStr
            });
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        users: users
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 指定児童の本日の集計データ取得
    if (action === 'get_student_summary') {
      var pClass = e.parameter.class || '';
      var pNumber = Number(e.parameter.number) || 0;
      var pDate = e.parameter.date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

      var logSheet = ss.getSheetByName('計算ドリル記録');
      var solvedCount = 0;
      var totalSeconds = 0;
      var totalMistakes = 0;
      var firstTryCount = 0;

      if (logSheet) {
        var logValues = logSheet.getDataRange().getValues();
        for (var j = 1; j < logValues.length; j++) {
          var row = logValues[j];
          var rowClass = String(row[1]);
          var rowNum = Number(row[2]);
          var rowDate = String(row[11]);

          if (rowClass === pClass && rowNum === pNumber && rowDate === pDate) {
            solvedCount++;
            var sec = Number(row[8]) || 0;
            var mis = Number(row[9]) || 0;
            totalSeconds += sec;
            totalMistakes += mis;
            if (mis === 0) firstTryCount++;
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        summary: {
          className: pClass,
          studentNumber: pNumber,
          date: pDate,
          solvedCount: solvedCount,
          totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
          avgSeconds: solvedCount > 0 ? Math.round(totalSeconds / solvedCount) : 0,
          totalMistakes: totalMistakes,
          accuracy: solvedCount > 0 ? Math.round((firstTryCount / solvedCount) * 100) : 100
        }
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2-2. 学習状況の集計（難易度設計の分析用・管理者専用）。個々のログやニックネームは返さず集計値のみ
    if (action === 'learning_stats') {
      return ContentService.createTextOutput(JSON.stringify(computeLearningStats(ss)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. スプレッドシート内部の全シート検証（デバッグ・調査用）
    if (action === 'inspect_sheets') {
      var sheets = ss.getSheets();
      var result = [];
      for (var s = 0; s < sheets.length; s++) {
        var sh = sheets[s];
        var sName = sh.getName();
        var numRows = sh.getLastRow();
        var numCols = sh.getLastColumn();
        var sampleRows = [];
        var sampleDisplayRows = [];
        var numberFormats = [];
        if (numRows > 0 && numCols > 0) {
          var limit = (e && e.parameter && e.parameter.limit) ? Math.min(500, Math.max(1, Number(e.parameter.limit))) : 10;
          var startR = Math.max(1, numRows - limit + 1);
          var countR = numRows - startR + 1;
          var range = sh.getRange(startR, 1, countR, Math.min(15, numCols));
          sampleRows = range.getValues();
          sampleDisplayRows = range.getDisplayValues();
          numberFormats = range.getNumberFormats();
        }
        var headers = (numRows > 0 && numCols > 0) ? sh.getRange(1, 1, 1, Math.min(15, numCols)).getValues()[0] : [];
        result.push({
          sheetName: sName,
          lastRow: numRows,
          lastColumn: numCols,
          headers: headers,
          sampleRows: sampleRows,
          sampleDisplayRows: sampleDisplayRows,
          numberFormats: numberFormats
        });
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        sheets: result
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. 「計算ドリル記録」シートのヘッダー＆正解日付化バグの一括修復
    if (action === 'fix_sheets') {
      var fixRes = fixLogSheetData(ss);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: '計算ドリル記録シートのヘッダーと正解データを修復しました。',
        fixedCount: fixRes.fixedCount,
        totalRows: fixRes.totalRows
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. 「研究用_学習曲線」シートの単元別グラフ自動再構築
    if (action === 'setup_research') {
      var res = setupResearchSheet();
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: '研究用_学習曲線シートを単元別グラフ機能付きで再構築しました。',
        result: res
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5-1. 「日別集計」「研究用_学習曲線」の数式だけを最新化（選択値・グラフは保持）
    if (action === 'refresh_sheets') {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        result: refreshAnalysisSheets()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5-2. 「日別集計」シートの再構築（時間指定対応）
    if (action === 'setup_daily') {
      var dailyRes = setupDailySummarySheet();
      return ContentService.createTextOutput(JSON.stringify(dailyRes)).setMimeType(ContentService.MimeType.JSON);
    }

    // 6. 「児童名簿」シートの全行（E〜J列）に自動計算式を一括強制適用
    if (action === 'apply_formulas') {
      var uSheet = getOrCreateUserSheet(ss);
      var formulaRes = ensureUserSheetFormulas(uSheet, true);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: '児童名簿の全行（E〜J列）に自動計算式を一括適用しました。',
        appliedRows: formulaRes.appliedRows
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 7. テスト行のクリーンアップ
    if (action === 'clean_test_rows') {
      var lSheet = ss.getSheetByName('計算ドリル記録');
      var deleted = 0;
      if (lSheet) {
        var lVals = lSheet.getDataRange().getValues();
        for (var rowIdx = lVals.length - 1; rowIdx >= 1; rowIdx--) {
          var rData = lVals[rowIdx];
          if (String(rData[10]).indexOf('test_') === 0 || (Number(rData[2]) === 45 && String(rData[4]).indexOf('1/2 + 1/2') !== -1)) {
            lSheet.deleteRow(rowIdx + 1);
            deleted++;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        deletedRows: deleted
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 8. 重複ログの検出・調査
    if (action === 'find_duplicates') {
      var lSheet = ss.getSheetByName('計算ドリル記録');
      var duplicates = [];
      if (lSheet) {
        var lVals = lSheet.getDataRange().getValues();
        var seenMap = {};
        for (var i = 1; i < lVals.length; i++) {
          var r = lVals[i];
          var key = r[12] ? 'id:' + r[12] : [r[1], r[2], r[10], r[4], r[7], r[8], r[9]].join('|');
          if (!seenMap[key]) {
            seenMap[key] = [i + 1];
          } else {
            seenMap[key].push(i + 1);
            duplicates.push({
              row: i + 1,
              originalRow: seenMap[key][0],
              data: [r[0], r[1], r[2], r[3], r[4], r[7], r[8], r[9], r[10]]
            });
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        totalRows: lSheet ? lSheet.getLastRow() : 0,
        duplicateCount: duplicates.length,
        sampleDuplicates: duplicates.slice(0, 30)
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 9. 重複ログの自動削除・クリーンアップ（一括配列処理で超高速実行！）
    if (action === 'deduplicate_logs') {
      var dedupRes = deduplicateLogSheet(ss);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        deletedCount: dedupRes.deletedCount,
        remainingRows: dedupRes.remainingRows
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 10. 「研究用_学習曲線」の現在の状態とグラフ調査
    if (action === 'inspect_research') {
      var rSheet = ss.getSheetByName('研究用_学習曲線');
      if (!rSheet) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'not_found' })).setMimeType(ContentService.MimeType.JSON);
      }
      var charts = rSheet.getCharts();
      var chartDetails = [];
      for (var ci = 0; ci < charts.length; ci++) {
        var c = charts[ci];
        var ranges = [];
        var cRanges = c.getRanges();
        for (var ri = 0; ri < cRanges.length; ri++) {
          ranges.push(cRanges[ri].getA1Notation());
        }
        chartDetails.push({
          ranges: ranges,
          optionsObj: JSON.parse(JSON.stringify(c.getOptions() || {}))
        });
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        chartCount: charts.length,
        charts: chartDetails,
        rowCount: rSheet.getLastRow(),
        b1: rSheet.getRange('B1').getValue(),
        d1: rSheet.getRange('D1').getValue(),
        f1: rSheet.getRange('F1').getValue(),
        h1: rSheet.getRange('H1').getValue()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 11. 「研究用_学習曲線」のグラフを2軸に更新
    if (action === 'update_research_chart') {
      var chartMode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : 'line';
      var updateRes = updateResearchChart(chartMode);
      return ContentService.createTextOutput(JSON.stringify(updateRes)).setMimeType(ContentService.MimeType.JSON);
    }

    // 12. 「日別集計」の現在の内容と数式検証
    if (action === 'inspect_daily') {
      var dSheet = ss.getSheetByName('日別集計');
      if (!dSheet) return ContentService.createTextOutput(JSON.stringify({ status: 'not_found' })).setMimeType(ContentService.MimeType.JSON);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        row1: dSheet.getRange('A1:K1').getValues()[0],
        row1Formulas: dSheet.getRange('A1:K1').getFormulas()[0],
        row2: dSheet.getRange('A2:H2').getValues()[0],
        row4: dSheet.getRange('A4:H4').getValues()[0],
        row4Formulas: dSheet.getRange('A4:H4').getFormulas()[0],
        avgRow: dSheet.getRange('A49:H49').getValues()[0]
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // デフォルト: 稼働ステータス確認
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      message: '分数30分ドリル用スプレッドシートAPIは正常に動作しています。',
      serverTime: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- 児童名簿シートの自動計算式設定（GAS軽量化・同時実行制限対策） ---

/**
 * 「児童名簿」r行目の E〜J 列の計算式。
 * 答えを表示して次へ進んだ問題（P列=答え表示）は、累計問題数・1発正解率・平均解答時間に数えない
 * （学習時間と累計ミス回数には含める）
 */
function userRowFormulas(r) {
  var L = "'計算ドリル記録'!";
  var me = L + "$B:$B, $B" + r + ", " + L + "$C:$C, $C" + r;
  var solvedOnly = ", " + L + "$P:$P, \"<>答え表示\"";
  return [
    "=COUNTIFS(" + me + solvedOnly + ")",
    "=IF($E" + r + ">0, ROUND(SUMIFS(" + L + "$I:$I, " + me + ")/60, 1), 0)",
    "=IF($E" + r + ">0, ROUND(COUNTIFS(" + me + ", " + L + "$J:$J, 0" + solvedOnly + ") / $E" + r + " * 100), 100)",
    "=IF($E" + r + ">0, ROUND(SUMIFS(" + L + "$I:$I, " + me + solvedOnly + ") / $E" + r + "), 0)",
    "=SUMIFS(" + L + "$J:$J, " + me + ")",
    "=IF($E" + r + ">0, IFERROR(TEXT(MAXIFS(" + L + "$A:$A, " + me + "), \"yyyy-mm-dd hh:mm:ss\"), \"\"), \"\")"
  ];
}

/**
 * ⚡ 「児童名簿」シートの全生徒行（E〜J列）にスプレッドシート関数を適用・保証
 * - forceAll が true の場合は全行に強制上書き
 * - false の場合は数式が未設定または空の行がある場合のみ自動適用
 */
function ensureUserSheetFormulas(userSheet, forceAll) {
  if (!userSheet) return { appliedRows: 0 };
  var lastRow = userSheet.getLastRow();
  if (lastRow <= 1) return { appliedRows: 0 };

  var numRows = lastRow - 1;
  var existingFormulas = userSheet.getRange(2, 5, numRows, 6).getFormulas();
  var needsUpdate = !!forceAll;

  if (!needsUpdate) {
    for (var i = 0; i < numRows; i++) {
      // E〜J列のいずれかに数式が入っていない、または旧式（答え表示を除外しない）数式の場合、更新対象とする
      if (!existingFormulas[i][0] || !existingFormulas[i][1] || !existingFormulas[i][2] ||
          !existingFormulas[i][3] || !existingFormulas[i][4] || !existingFormulas[i][5] ||
          existingFormulas[i][0].indexOf('答え表示') === -1) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (!needsUpdate) {
    return { appliedRows: 0 };
  }

  var formulas = [];
  for (var r = 2; r <= lastRow; r++) {
    formulas.push(userRowFormulas(r));
  }

  userSheet.getRange(2, 5, numRows, 6).setFormulas(formulas);
  return { appliedRows: numRows };
}

/**
 * ⚡ 「児童名簿」シートの全生徒行（E〜J列）にスプレッドシート関数を一括セット（メニュー用）
 */
function applyUserSheetFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var userSheet = getOrCreateUserSheet(ss);
  var res = ensureUserSheetFormulas(userSheet, true);

  if (res.appliedRows === 0) {
    SpreadsheetApp.getUi().alert('児童名簿にデータがありません。クラスと番号を入力してください。');
    return;
  }

  SpreadsheetApp.getUi().alert(
    '⚡ 児童名簿（2行目〜' + (res.appliedRows + 1) + '行目）に自動計算式を一括設定しました！\n\n' +
    '・原本ログからリアルタイムで自動集計されます\n' +
    '・GASの通信負荷が最小化され、混雑時の安定性が大幅に向上しました。'
  );
}

/**
 * 👥 「計算ドリル記録」の全過去ログから未登録児童を名簿に追加し、全行に関数を再適用
 */
function recalculateAllUserSummaries() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('計算ドリル記録');
  var userSheet = getOrCreateUserSheet(ss);

  if (!logSheet) {
    SpreadsheetApp.getUi().alert('計算ドリル記録シートが見つかりません。');
    return;
  }

  var logValues = logSheet.getDataRange().getValues();
  if (logValues.length <= 1) {
    SpreadsheetApp.getUi().alert('計算ドリル記録にデータがまだありません。');
    return;
  }

  var userValues = userSheet.getDataRange().getValues();
  var rowMap = {};
  for (var u = 1; u < userValues.length; u++) {
    var k = String(userValues[u][1]) + '_' + String(userValues[u][2]);
    rowMap[k] = u + 1;
  }

  var insertedCount = 0;
  for (var i = 1; i < logValues.length; i++) {
    var r = logValues[i];
    var c = String(r[1]).trim();
    var n = Number(r[2]);
    if (!c || !n) continue;

    var sKey = c + '_' + n;
    if (!rowMap[sKey]) {
      var newR = userSheet.getLastRow() + 1;
      userSheet.appendRow([
        new Date(),
        c,
        n,
        String(r[3] || '児童')
      ].concat(userRowFormulas(newR)));
      rowMap[sKey] = newR;
      insertedCount++;
    }
  }

  // 全行の数式を再確認・保証
  var res = ensureUserSheetFormulas(userSheet, true);

  SpreadsheetApp.getUi().alert(
    '児童名簿の自動計算式設定および未登録児童の同期が完了しました！\n\n' +
    '・数式適用行: ' + res.appliedRows + ' 件\n' +
    '・新規名簿追加: ' + insertedCount + ' 名'
  );
}

// --- シート取得・作成ヘルパー ---

function getOrCreateLogSheet(ss) {
  var sheetName = '計算ドリル記録';
  var sheet = ss.getSheetByName(sheetName);
  var headers = [
    '記録日時', 'クラス', '出席番号', 'ニックネーム',
    '問題式', '演算', '単元分類', '正解',
    '所要時間(秒)', '間違えた回数', 'セッションID', '日付(検索用)', 'ログID',
    '出題段階', '種別', '答え表示'
  ];

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, LOG_COLS).setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // ヘッダーが最新と一致している場合は書式設定をスキップ（毎回の保存処理を軽くしてロック待ちを短縮）
    var curHeaders = sheet.getRange(1, 1, 1, LOG_COLS).getValues()[0];
    if (curHeaders.join('\t') === headers.join('\t')) {
      return sheet;
    }
    // 既存シートのヘッダーが古いまたはずれている場合は最新13項目に上書き修復
    sheet.getRange(1, 1, 1, LOG_COLS).setValues([headers]);
    sheet.getRange(1, 1, 1, LOG_COLS).setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // スプレッドシート全体のタイムゾーンを日本時間に保証
  ss.setSpreadsheetTimeZone('Asia/Tokyo');

  // A列(記録日時)を表示形式「yyyy-MM-dd HH:mm:ss」にして時間まで確実に表示！
  sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
  sheet.setColumnWidth(1, 165);

  // E列(問題式)、H列(正解)、L列(日付)をプレーンテキスト書式に設定して日付誤爆を防止
  sheet.getRange('E:E').setNumberFormat('@');
  sheet.getRange('H:H').setNumberFormat('@');
  sheet.getRange('L:L').setNumberFormat('@');

  return sheet;
}

/**
 * 🛠️ 「計算ドリル記録」シートの全データ修復
 * - ヘッダーを正しい16項目に更新
 * - 日付型に勝手に誤変換されてしまった正解データを元の分数文字列に復元
 * - 列幅の自動調整
 */
function fixLogSheetData(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateLogSheet(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { fixedCount: 0, totalRows: 0 };

  // スプレッドシート全体のタイムゾーンを日本時間に保証
  ss.setSpreadsheetTimeZone('Asia/Tokyo');

  // A列(記録日時)の全行の表示形式を日付＋時間（yyyy-MM-dd HH:mm:ss）に設定
  sheet.getRange('A2:A' + lastRow).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  sheet.setColumnWidth(1, 165);

  var dataRange = sheet.getRange(2, 1, lastRow - 1, 12);
  var values = dataRange.getValues();
  var fixedCount = 0;

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var ans = row[7]; // H列 (index 7: 正解)
    var formula = String(row[4] || ''); // E列: 問題式
    var dt = row[0]; // A列: 記録日時

    // 1. 正解がDate型またはISO文字列になってしまっている場合の復元
    if (ans instanceof Date || (typeof ans === 'string' && ans.indexOf('T') !== -1 && ans.indexOf('-') !== -1)) {
      var dObj = (ans instanceof Date) ? ans : new Date(ans);
      if (!isNaN(dObj.getTime())) {
        var m = dObj.getMonth() + 1; // 1-12
        var d = dObj.getDate();      // 1-31
        // スプレッドシートは 7/8 を 7月8日、1/2 を 1月2日として保存した
        row[7] = "'" + m + "/" + d;
        fixedCount++;
      }
    } else if (ans !== '') {
      row[7] = "'" + String(ans).trim();
    }

    // 2. 問題式もテキスト保証
    if (formula !== '') {
      row[4] = "'" + formula.trim();
    }

    // 3. 日付(L列)の正確な日本時間文字列化
    if (dt) {
      try {
        var dDate = (dt instanceof Date) ? dt : new Date(dt);
        row[11] = "'" + Utilities.formatDate(dDate, 'Asia/Tokyo', 'yyyy-MM-dd');
      } catch(e) {}
    }
  }

  // 書式をプレーンテキストにして一括書き戻し
  sheet.getRange('E:E').setNumberFormat('@');
  sheet.getRange('H:H').setNumberFormat('@');
  sheet.getRange('L:L').setNumberFormat('@');
  dataRange.setValues(values);

  // 見栄えの最適化（列幅自動調整）
  sheet.autoResizeColumns(1, 12);
  sheet.setColumnWidth(1, 165);

  return { fixedCount: fixedCount, totalRows: values.length };
}

function getOrCreateUserSheet(ss) {
  var sheetName = '児童名簿';
  var sheet = ss.getSheetByName(sheetName);
  var headers = [
    '最終更新日時',       // A (index 0)
    'クラス',             // B (index 1)
    '出席番号',           // C (index 2)
    'ニックネーム',       // D (index 3)
    '累計問題数',         // E (index 4)
    '累計学習時間(分)',   // F (index 5)
    '1発正解率(%)',       // G (index 6)
    '平均解答時間(秒)',   // H (index 7)
    '累計ミス回数',       // I (index 8)
    '最終学習日時'        // J (index 9)
  ];

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setBackground('#059669').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // 既存シートのヘッダーが短い場合は10列に拡張
    var curCols = Math.max(sheet.getLastColumn(), headers.length);
    var curRow1 = sheet.getRange(1, 1, 1, curCols).getValues()[0];
    if (curRow1.length < headers.length || !curRow1[4]) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setBackground('#059669').setFontColor('#ffffff').setFontWeight('bold');
    } else {
      // 正常なシートでは書式設定をスキップ（名簿取得のたびに書き込むと同時アクセス時に遅くなる）
      return sheet;
    }
  }

  // 列幅を美しく設定
  sheet.setColumnWidth(1, 160); // 最終更新日時
  sheet.setColumnWidth(2, 90);  // クラス
  sheet.setColumnWidth(3, 80);  // 出席番号
  sheet.setColumnWidth(4, 120); // ニックネーム
  sheet.setColumnWidth(5, 100); // 累計問題数
  sheet.setColumnWidth(6, 120); // 累計学習時間(分)
  sheet.setColumnWidth(7, 100); // 1発正解率(%)
  sheet.setColumnWidth(8, 120); // 平均解答時間(秒)
  sheet.setColumnWidth(9, 100); // 累計ミス回数
  sheet.setColumnWidth(10, 160);// 最終学習日時

  // A列(最終更新日時)の表示形式を日付＋時間（yyyy-MM-dd HH:mm:ss）に設定
  sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');

  return sheet;
}

/**
 * 📊 「日別集計」シートの作成・フォーミュラ設定
 * - 集計日付 ＆ クラス ＆ 開始時刻〜終了時刻（何時から何時まで）の絞り込み集計に完全対応！
 */
/**
 * 「日別集計」出席番号 num の行（4〜48行目）の A〜H 列。
 * 答えを表示して次へ進んだ問題は、問題数・平均解答時間・1発正解数に数えない
 */
function dailyRowFormulas(num) {
  var row = num + 3;
  var L = '計算ドリル記録!';
  var me = L + '$B:$B, $D$1, ' + L + '$C:$C, ' + num + ', ' + L + '$A:$A, ">="&$J$1, ' + L + '$A:$A, "<="&$K$1';
  var solvedOnly = ', ' + L + '$P:$P, "<>答え表示"';
  return [
    num,                                                                                         // A: 番号
    '=IFERROR(INDEX(児童名簿!$D:$D, MATCH(1, (児童名簿!$B:$B=$D$1)*(児童名簿!$C:$C=' + num + '), 0)), "-")', // B: ニックネーム
    '=COUNTIFS(' + me + solvedOnly + ')',                                                          // C: 解いた問題数
    '=IF(C' + row + '=0, 0, ROUND(SUMIFS(' + L + '$I:$I, ' + me + ')/60, 1))',                     // D: 学習時間(分)
    '=IF(C' + row + '=0, "-", ROUND(SUMIFS(' + L + '$I:$I, ' + me + solvedOnly + ')/C' + row + ', 0))', // E: 平均解答時間(秒)
    '=IF(C' + row + '=0, "-", SUMIFS(' + L + '$J:$J, ' + me + '))',                                // F: 間違えた回数
    '=IF(C' + row + '=0, "-", COUNTIFS(' + me + ', ' + L + '$J:$J, 0' + solvedOnly + '))',          // G: 1発正解数
    '=IF(C' + row + '=0, "-", TEXT(G' + row + '/C' + row + ', "0.0%"))'                            // H: 1発正解率
  ];
}

function setupDailySummarySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = '日別集計';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  // 1. コントロール部 (1行目: 日付・クラス・開始時刻・終了時刻)
  // A1-B1: 集計日付
  sheet.getRange('A1').setValue('📅 集計日付:').setFontWeight('bold').setBackground('#f1f5f9');
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  sheet.getRange('B1').setValue(todayStr).setNumberFormat('@').setBackground('#fef3c7').setFontWeight('bold');

  // C1-D1: クラス
  sheet.getRange('C1').setValue('🏫 クラス:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('D1').setValue('5年1組').setBackground('#fef3c7').setFontWeight('bold');
  var classRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['5年1組', '5年2組', '5年3組', '5年4組', '5年5組', '5年6組'], true)
    .build();
  sheet.getRange('D1').setDataValidation(classRule);

  // E1-F1: 開始時刻（何時から）
  sheet.getRange('E1').setValue('⏰ 開始時刻:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('F1').setValue('').setBackground('#fef3c7').setFontWeight('bold').setNumberFormat('@');

  // G1-H1: 終了時刻（何時まで）
  sheet.getRange('G1').setValue('⏰ 終了時刻:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('H1').setValue('').setBackground('#fef3c7').setFontWeight('bold').setNumberFormat('@');

  // 時刻入力用プルダウン候補（自由手入力も可能）
  var timeCandidates = [
    '',
    '08:00', '08:15', '08:30', '08:45',
    '09:00', '09:15', '09:30', '09:45',
    '10:00', '10:15', '10:30', '10:45',
    '11:00', '11:15', '11:30', '11:45',
    '12:00', '12:15', '12:30', '12:45',
    '13:00', '13:15', '13:30', '13:45',
    '14:00', '14:15', '14:30', '14:45',
    '15:00', '15:15', '15:30', '15:45',
    '16:00', '16:15', '16:30', '17:00'
  ];
  var timeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(timeCandidates, false)
    .build();
  sheet.getRange('F1').setDataValidation(timeRule);
  sheet.getRange('H1').setDataValidation(timeRule);

  // J1: 判定用・開始日時シリアル値
  // 日付 + 開始時刻(未指定なら00:00:00)
  sheet.getRange('J1').setFormula(
    '=IF(ISBLANK($B$1), TODAY(), IF(ISNUMBER($B$1), INT($B$1), DATEVALUE($B$1))) + IF(ISBLANK($F$1), 0, IF(ISNUMBER($F$1), $F$1 - INT($F$1), TIMEVALUE($F$1)))'
  ).setNumberFormat('yyyy-MM-dd HH:mm:ss').setFontColor('#94a3b8');

  // K1: 判定用・終了日時シリアル値
  // 日付 + 終了時刻(未指定なら23:59:59)
  sheet.getRange('K1').setFormula(
    '=IF(ISBLANK($B$1), TODAY(), IF(ISNUMBER($B$1), INT($B$1), DATEVALUE($B$1))) + IF(ISBLANK($H$1), TIME(23,59,59), IF(ISNUMBER($H$1), $H$1 - INT($H$1), TIMEVALUE($H$1)))'
  ).setNumberFormat('yyyy-MM-dd HH:mm:ss').setFontColor('#94a3b8');

  // 2行目: 状態サマリーバー
  sheet.getRange('A2').setValue('🎯 集計範囲:').setFontWeight('bold').setBackground('#f8fafc');
  sheet.getRange('B2').setFormula(
    '=IF(AND(ISBLANK(F1), ISBLANK(H1)), "【終日】 00:00 〜 23:59 の全ログ", TEXT(J1, "yyyy/mm/dd hh:mm") & " 〜 " & TEXT(K1, "hh:mm") & " のログ")'
  ).setFontWeight('bold').setFontColor('#1e40af');

  sheet.getRange('E2').setValue('※時刻を空欄にすると【終日】集計になります（例: 10:45 〜 11:30）')
    .setFontColor('#64748b').setFontSize(9);

  // 枠線
  sheet.getRange('A1:H1').setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange('A2:H2').setBorder(true, true, true, true, false, false, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);

  // 3. 表ヘッダー
  var headers = [
    '出席番号', 'ニックネーム', '解いた問題数', '学習時間(分)',
    '平均解答時間(秒)', '間違えた回数(合計)', '1発正解数', '1発正解率'
  ];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers])
    .setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(3);

  // 4. 各出席番号（1〜45番）の数式設定（開始日時 J1 〜 終了日時 K1 で範囲フィルタ）
  var formulaRows = [];
  for (var num = 1; num <= 45; num++) {
    formulaRows.push(dailyRowFormulas(num));
  }
  sheet.getRange(4, 1, 45, headers.length).setValues(formulaRows);

  // 5. クラス平均行 (49行目)
  var avgRow = [
    '【クラス平均】',
    '-',
    '=IFERROR(ROUND(AVERAGEIF(C4:C48, ">0"), 1), 0)',
    '=IFERROR(ROUND(AVERAGEIF(D4:D48, ">0"), 1), 0)',
    '=IFERROR(ROUND(AVERAGEIF(E4:E48, ">0"), 0), "-")',
    '=IFERROR(SUM(F4:F48), 0)',
    '=IFERROR(SUM(G4:G48), 0)',
    '=IFERROR(TEXT(SUM(G4:G48)/SUM(C4:C48), "0.0%"), "-")'
  ];
  sheet.getRange(49, 1, 1, headers.length).setValues([avgRow])
    .setBackground('#dbeafe').setFontWeight('bold');

  // 列幅設定
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 130);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(8, 110);
  sheet.getRange(4, 1, 46, headers.length).setHorizontalAlignment('center');

  // J列・K列（内部判定用）は非表示にして画面をすっきり整理
  sheet.hideColumns(10, 2);

  return { status: 'success', message: '日別集計シートを時間指定（何時から何時まで）対応版で再構築しました。' };
}

/**
 * 📈 「研究用_学習曲線」シートの作成 ＆ 単元別グラフ自動生成
 */
function setupResearchSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = '研究用_学習曲線';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
    // 既存のグラフを一旦全削除
    var oldCharts = sheet.getCharts();
    for (var c = 0; c < oldCharts.length; c++) {
      sheet.removeChart(oldCharts[c]);
    }
  }

  // --- 1行目: 条件指定コントロールバー ---
  // A1-B1: クラス
  sheet.getRange('A1').setValue('🏫 クラス:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('B1').setValue('5年1組').setBackground('#fef3c7').setFontWeight('bold');
  var classRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['5年1組', '5年2組', '5年3組', '5年4組', '5年5組', '5年6組'], true)
    .build();
  sheet.getRange('B1').setDataValidation(classRule);

  // C1-D1: 出席番号
  sheet.getRange('C1').setValue('出席番号:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('D1').setValue(1).setBackground('#fef3c7').setFontWeight('bold');
  var numList = ['全員'];
  for (var n = 1; n <= 45; n++) numList.push(String(n));
  var numRule = SpreadsheetApp.newDataValidation().requireValueInList(numList, true).build();
  sheet.getRange('D1').setDataValidation(numRule);

  // E1-F1: 児童名
  sheet.getRange('E1').setValue('児童名:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('F1').setFormula('=IF($D$1="全員", "【学級全員】", IFERROR(INDEX(児童名簿!$D:$D, MATCH(1, (児童名簿!$B:$B=$B$1)*(児童名簿!$C:$C=VALUE($D$1)), 0)), "未登録"))')
    .setFontWeight('bold').setFontColor('#15803d');

  // G1-H1: 単元分類フィルター（ユーザーの要望！）
  sheet.getRange('G1').setValue('🎯 単元分類:').setFontWeight('bold').setBackground('#f1f5f9');
  sheet.getRange('H1').setValue('すべて（全単元）').setBackground('#fef3c7').setFontWeight('bold');
  var unitList = [
    'すべて（全単元）',
    '真分数の足し算',
    '真分数の引き算',
    '帯分数の足し算',
    '帯分数の足し算（繰り上がりあり）',
    '帯分数の引き算',
    '帯分数の引き算（繰り下がりあり）',
    '約分あり'
  ];
  var unitRule = SpreadsheetApp.newDataValidation().requireValueInList(unitList, true).build();
  sheet.getRange('H1').setDataValidation(unitRule);

  applyResearchLayout(sheet);

  // --- 📈 複合グラフの自動生成（所要時間 ＆ エラー率・ミスの可視化） ---
  insertResearchChart(sheet);

  return { status: 'success', sheet: sheetName };
}

// 研究用シートの種別フィルター（I1-J1）の選択肢
var RESEARCH_KIND_OPTIONS = ['すべて', '計測球のみ', '練習球のみ', '第1期（段階導入前）のみ'];

/**
 * 「研究用_学習曲線」の種別フィルター・サマリー・見出し・抽出数式を設定する。
 * クラス/出席番号/単元の選択値とグラフは触らないので、既存シートに再適用しても安全。
 */
function applyResearchLayout(sheet) {
  // I1-J1: 種別フィルター（計測球/練習球/第1期）。既に選んでいる値は保持
  sheet.getRange('I1').setValue('📏 種別:').setFontWeight('bold').setBackground('#f1f5f9');
  var kindCell = sheet.getRange('J1');
  if (RESEARCH_KIND_OPTIONS.indexOf(String(kindCell.getValue())) === -1) kindCell.setValue('すべて');
  kindCell.setBackground('#fef3c7').setFontWeight('bold')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(RESEARCH_KIND_OPTIONS, true).build());

  // --- 2行目: リアルタイム成績サマリーバー ---
  sheet.getRange('A2').setValue('📊 対象問題数:').setFontWeight('bold');
  sheet.getRange('B2').setFormula('=COUNT(F4:F)').setFontWeight('bold').setFontColor('#2563eb');

  sheet.getRange('C2').setValue('⚡ 平均解答秒数:').setFontWeight('bold');
  sheet.getRange('D2').setFormula('=IFERROR(ROUND(AVERAGE(F4:F), 1) & " 秒", "-")').setFontWeight('bold').setFontColor('#d97706');

  sheet.getRange('E2').setValue('🎯 1発正解率:').setFontWeight('bold');
  sheet.getRange('F2').setFormula('=IFERROR(ROUND(COUNTIF(G4:G, 0) / MAX(1, COUNT(F4:F)) * 100, 1) & " %", "-")').setFontWeight('bold').setFontColor('#16a34a');

  sheet.getRange('G2').setValue('💥 総ミス回数:').setFontWeight('bold');
  sheet.getRange('H2').setFormula('=IFERROR(SUM(G4:G) & " 回", "-")').setFontWeight('bold').setFontColor('#dc2626');

  sheet.getRange('A2:H2').setBackground('#f8fafc').setBorder(true, true, true, true, false, false);

  // --- 3行目: テーブルヘッダー（H列=答え表示、I列=結果） ---
  var headers = [
    '解いた順番', '記録日時', '問題式', '単元分類',
    '正解', '所要時間(秒)', '間違えた回数', '答え表示', '結果(1発/ミス)'
  ];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers])
    .setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(3);

  // --- 4行目以降: 自動抽出数式 ---
  // QUERY式: クラス、出席番号(全員対応)、単元分類(部分一致対応)、種別（O列: 計測球/練習球/空欄=第1期）
  var queryFormula = '=IFERROR(QUERY(計算ドリル記録!A2:P, "SELECT A, E, G, H, I, J, P WHERE B = \'" & $B$1 & "\' " & IF($D$1="全員", "", " AND C = " & $D$1) & IF($H$1="すべて（全単元）", "", IF($H$1="約分あり", " AND G CONTAINS \'約分\'", " AND G CONTAINS \'" & $H$1 & "\'")) & IF($J$1="計測球のみ", " AND O = \'計測球\'", IF($J$1="練習球のみ", " AND O = \'練習球\'", IF($J$1="第1期（段階導入前）のみ", " AND O IS NULL", ""))) & " ORDER BY A ASC", 0), "")';
  sheet.getRange('H4:I').clearContent(); // 旧レイアウト（H4に結果の数式）を消してから配置
  sheet.getRange('B4').setFormula(queryFormula);

  // A列: 解いた順番 (第 1 問, 第 2 問...)
  sheet.getRange('A4').setFormula('=ARRAYFORMULA(IF(ISBLANK(B4:B), "", "第 " & (ROW(B4:B)-3) & " 問"))');

  // I列: 結果 (○ 1発ヒット / 📖 答え表示 / × N回空振り)
  sheet.getRange('I4').setFormula('=ARRAYFORMULA(IF(ISBLANK(B4:B), "", IF(H4:H="答え表示", "📖 答え表示", IF(G4:G=0, "○ 1発ヒット", "× " & G4:G & "回空振り"))))');

  // 列幅設定
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 155);
  sheet.setColumnWidth(3, 140);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 90);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 110);
  sheet.setColumnWidth(8, 90);
  sheet.setColumnWidth(9, 120);

  // 書式
  sheet.getRange('F4:F').setNumberFormat('#,##0');
  sheet.getRange('G4:G').setNumberFormat('#,##0');
}

function insertResearchChart(sheet) {
  var chart = sheet.newChart()
    .asComboChart()
    .addRange(sheet.getRange('A3:A100')) // 横軸ラベル: 第1問, 第2問...
    .addRange(sheet.getRange('F3:F100')) // 系列1: 所要時間(秒) [折れ線]
    .addRange(sheet.getRange('G3:G100')) // 系列2: 間違えた回数 [棒グラフ]
    .setPosition(4, 10, 0, 0)           // J4セルから配置
    .setOption('title', '📈 学習曲線 ＆ エラー推移グラフ（問題ごとの解答秒数 ＆ ミス回数）')
    .setOption('titleTextStyle', { fontSize: 13, bold: true, color: '#0f172a' })
    .setOption('series', {
      0: { type: 'line', targetAxisIndex: 0, color: '#2563eb', lineWidth: 3, pointSize: 6, labelInLegend: '所要時間 (秒)' },
      1: { type: 'bars', targetAxisIndex: 1, color: '#ef4444', labelInLegend: '間違えた回数 (ミス)' }
    })
    .setOption('vAxes', {
      0: { title: '所要時間 (秒)', minValue: 0, titleTextStyle: { color: '#2563eb', bold: true } },
      1: { title: '間違えた回数 (回)', minValue: 0, titleTextStyle: { color: '#ef4444', bold: true } }
    })
    .setOption('hAxis', { title: '解いた問題の順番', slantedText: true, slantedTextAngle: 45 })
    .setOption('legend', { position: 'top' })
    .setOption('width', 740)
    .setOption('height', 400)
    .build();

  sheet.insertChart(chart);
}

/**
 * 🔄 既存の「日別集計」「研究用_学習曲線」を最新の数式・レイアウトに更新（非破壊）。
 * 日別集計の日付/クラス/時刻、研究用のクラス/番号/単元/種別の選択とグラフはそのまま残る。
 * clasp run refreshAnalysisSheets で実行できる（UI を使わないので API 実行可）
 */
function refreshAnalysisSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = { daily: 'not_found', research: 'not_found' };
  var daily = ss.getSheetByName('日別集計');
  if (daily) {
    var rows = [];
    for (var num = 1; num <= 45; num++) rows.push(dailyRowFormulas(num));
    daily.getRange(4, 1, 45, 8).setValues(rows);
    result.daily = 'updated';
  }
  var research = ss.getSheetByName('研究用_学習曲線');
  if (research) {
    applyResearchLayout(research);
    result.research = 'updated';
  }
  return result;
}

/**
 * 📈 「研究用_学習曲線」のグラフを左右2軸グラフに更新
 * @param {string} mode 'line'（両方折れ線）または 'combo'（折れ線＋棒グラフ）
 */
function updateResearchChart(mode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('研究用_学習曲線');
  if (!sheet) return { status: 'error', message: '「研究用_学習曲線」シートが見つかりません。' };

  var isLine = (mode === 'line');

  // 既存のグラフを全て削除
  var charts = sheet.getCharts();
  for (var i = 0; i < charts.length; i++) {
    sheet.removeChart(charts[i]);
  }

  // 左右2軸グラフを新規作成
  var chartBuilder = sheet.newChart()
    .asComboChart()
    .addRange(sheet.getRange('A3:A100')) // 横軸: 解いた問題の順番
    .addRange(sheet.getRange('F3:F100')) // 系列1: 所要時間(秒) -> 左軸
    .addRange(sheet.getRange('G3:G100')) // 系列2: 間違えた回数 -> 右軸
    .setPosition(4, 10, 0, 0)           // J4セルに配置
    .setOption('title', '📈 学習曲線 ＆ エラー推移グラフ（問題ごとの解答秒数 ＆ ミス回数）')
    .setOption('titleTextStyle', { fontSize: 13, bold: true, color: '#0f172a' })
    .setOption('series', {
      0: {
        type: 'line',
        targetAxisIndex: 0,
        color: '#2563eb',
        lineWidth: 3,
        pointSize: 5,
        labelInLegend: '所要時間 (秒) [左軸]'
      },
      1: {
        type: isLine ? 'line' : 'bars',
        targetAxisIndex: 1,
        color: '#ef4444',
        lineWidth: isLine ? 3 : 0,
        pointSize: isLine ? 6 : 0,
        labelInLegend: '間違えた回数 (ミス) [右軸]'
      }
    })
    .setOption('vAxes', {
      0: {
        title: '所要時間 (秒)',
        minValue: 0,
        titleTextStyle: { color: '#2563eb', bold: true }
      },
      1: {
        title: '間違えた回数 (回)',
        minValue: 0,
        titleTextStyle: { color: '#ef4444', bold: true },
        format: '#,##0'
      }
    })
    .setOption('hAxis', { title: '解いた問題の順番', slantedText: true, slantedTextAngle: 45 })
    .setOption('legend', { position: 'top' })
    .setOption('width', 780)
    .setOption('height', 420);

  var newChart = chartBuilder.build();
  sheet.insertChart(newChart);

  return {
    status: 'success',
    mode: isLine ? '2軸折れ線' : '2軸複合(折れ線+棒グラフ)',
    message: '「研究用_学習曲線」のグラフを左右2軸に更新しました！'
  };
}
