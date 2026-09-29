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
    .addItem('📊 「日別集計」シートを再構築', 'setupDailySummarySheet')
    .addItem('📈 「研究用_学習曲線」シートを再構築', 'setupResearchSheet')
    .addToUi();
}

function menuFixLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = fixLogSheetData(ss);
  SpreadsheetApp.getUi().alert('「計算ドリル記録」シートの修復が完了しました！\n\nヘッダーを正しい12項目に更新し、日付化していた正解データを ' + res.fixedCount + ' 件修復しました。');
}

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 学習ログの保存（重複排除チェック付きで安全・高速に追記！）
    if (data.action === 'save_logs' && data.logs && data.logs.length > 0) {
      var logSheet = getOrCreateLogSheet(ss);
      var lastRow = logSheet.getLastRow();

      // 直近の既存ログ（最新50行）を取得して重複照合用のセットを作成
      var recentSet = {};
      if (lastRow > 1) {
        var checkCount = Math.min(50, lastRow - 1);
        var checkStart = lastRow - checkCount + 1;
        var existingRecent = logSheet.getRange(checkStart, 1, checkCount, 12).getValues();
        for (var er = 0; er < existingRecent.length; er++) {
          var rVal = existingRecent[er];
          // クラス_番号_セッション_問題式_正解
          var eKey = [rVal[1], rVal[2], rVal[10], String(rVal[4]).replace(/^'/, '').trim(), String(rVal[7]).replace(/^'/, '').trim()].join('|');
          recentSet[eKey] = true;
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

        // 💥【超重要・同一問題の連打・重複記録を完全防止】
        var dupKey = [log.className || '', log.studentNumber ? Number(log.studentNumber) : '', sId, formulaStr, answerStr].join('|');
        if (seenInPayload[dupKey] || recentSet[dupKey]) {
          // すでに同一ペイロード内またはスプレッドシート直近行に存在する場合は重複としてスキップ！
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
          "'" + dateStr                                      // L: 日付 (YYYY-MM-DD)
        ]);
      }

      if (rows.length > 0) {
        lastRow = logSheet.getLastRow();
        logSheet.getRange(lastRow + 1, 1, rows.length, 12).setValues(rows);
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
          u.nickname,
          "=COUNTIFS('計算ドリル記録'!$B:$B, $B" + newRow + ", '計算ドリル記録'!$C:$C, $C" + newRow + ")",
          "=IF($E" + newRow + ">0, ROUND(SUMIFS('計算ドリル記録'!$I:$I, '計算ドリル記録'!$B:$B, $B" + newRow + ", '計算ドリル記録'!$C:$C, $C" + newRow + ")/60, 1), 0)",
          "=IF($E" + newRow + ">0, ROUND(COUNTIFS('計算ドリル記録'!$B:$B, $B" + newRow + ", '計算ドリル記録'!$C:$C, $C" + newRow + ", '計算ドリル記録'!$J:$J, 0) / $E" + newRow + " * 100), 100)",
          "=IF($E" + newRow + ">0, ROUND(SUMIFS('計算ドリル記録'!$I:$I, '計算ドリル記録'!$B:$B, $B" + newRow + ", '計算ドリル記録'!$C:$C, $C" + newRow + ") / $E" + newRow + "), 0)",
          "=SUMIFS('計算ドリル記録'!$J:$J, '計算ドリル記録'!$B:$B, $B" + newRow + ", '計算ドリル記録'!$C:$C, $C" + newRow + ")",
          "=IF($E" + newRow + ">0, IFERROR(TEXT(MAXIFS('計算ドリル記録'!$A:$A, '計算ドリル記録'!$B:$B, $B" + newRow + ", '計算ドリル記録'!$C:$C, $C" + newRow + "), \"yyyy-mm-dd hh:mm:ss\"), \"\"), \"\")"
        ]);
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
  }
}

function doGet(e) {
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
          var key = [r[1], r[2], r[10], r[4], r[7], r[8], r[9]].join('|');
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
      var lSheet = ss.getSheetByName('計算ドリル記録');
      var deletedRows = 0;
      if (lSheet) {
        var lastRow = lSheet.getLastRow();
        if (lastRow > 1) {
          var allValues = lSheet.getRange(2, 1, lastRow - 1, 12).getValues();
          var seenMap = {};
          var uniqueRows = [];

          for (var i = 0; i < allValues.length; i++) {
            var r = allValues[i];
            var key = [r[1], r[2], r[10], String(r[4]).replace(/^'/, '').trim(), String(r[7]).replace(/^'/, '').trim()].join('|');
            if (!seenMap[key]) {
              seenMap[key] = true;
              uniqueRows.push(r);
            } else {
              deletedRows++;
            }
          }

          if (deletedRows > 0) {
            // 2行目以降の全データをクリアして、ユニーク行だけを一括書き戻し！
            lSheet.getRange(2, 1, lastRow - 1, 12).clearContent();
            lSheet.getRange(2, 1, uniqueRows.length, 12).setValues(uniqueRows);
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
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        deletedCount: deletedRows,
        remainingRows: lSheet ? lSheet.getLastRow() : 0
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
      // E〜J列のいずれかに数式が入っていない場合、更新対象とする
      if (!existingFormulas[i][0] || !existingFormulas[i][1] || !existingFormulas[i][2] ||
          !existingFormulas[i][3] || !existingFormulas[i][4] || !existingFormulas[i][5]) {
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
    formulas.push([
      "=COUNTIFS('計算ドリル記録'!$B:$B, $B" + r + ", '計算ドリル記録'!$C:$C, $C" + r + ")",
      "=IF($E" + r + ">0, ROUND(SUMIFS('計算ドリル記録'!$I:$I, '計算ドリル記録'!$B:$B, $B" + r + ", '計算ドリル記録'!$C:$C, $C" + r + ")/60, 1), 0)",
      "=IF($E" + r + ">0, ROUND(COUNTIFS('計算ドリル記録'!$B:$B, $B" + r + ", '計算ドリル記録'!$C:$C, $C" + r + ", '計算ドリル記録'!$J:$J, 0) / $E" + r + " * 100), 100)",
      "=IF($E" + r + ">0, ROUND(SUMIFS('計算ドリル記録'!$I:$I, '計算ドリル記録'!$B:$B, $B" + r + ", '計算ドリル記録'!$C:$C, $C" + r + ") / $E" + r + "), 0)",
      "=SUMIFS('計算ドリル記録'!$J:$J, '計算ドリル記録'!$B:$B, $B" + r + ", '計算ドリル記録'!$C:$C, $C" + r + ")",
      "=IF($E" + r + ">0, IFERROR(TEXT(MAXIFS('計算ドリル記録'!$A:$A, '計算ドリル記録'!$B:$B, $B" + r + ", '計算ドリル記録'!$C:$C, $C" + r + "), \"yyyy-mm-dd hh:mm:ss\"), \"\"), \"\")"
    ]);
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
        String(r[3] || '児童'),
        "=COUNTIFS('計算ドリル記録'!$B:$B, $B" + newR + ", '計算ドリル記録'!$C:$C, $C" + newR + ")",
        "=IF($E" + newR + ">0, ROUND(SUMIFS('計算ドリル記録'!$I:$I, '計算ドリル記録'!$B:$B, $B" + newR + ", '計算ドリル記録'!$C:$C, $C" + newR + ")/60, 1), 0)",
        "=IF($E" + newR + ">0, ROUND(COUNTIFS('計算ドリル記録'!$B:$B, $B" + newR + ", '計算ドリル記録'!$C:$C, $C" + newR + ", '計算ドリル記録'!$J:$J, 0) / $E" + newR + " * 100), 100)",
        "=IF($E" + newR + ">0, ROUND(SUMIFS('計算ドリル記録'!$I:$I, '計算ドリル記録'!$B:$B, $B" + newR + ", '計算ドリル記録'!$C:$C, $C" + newR + ") / $E" + newR + "), 0)",
        "=SUMIFS('計算ドリル記録'!$J:$J, '計算ドリル記録'!$B:$B, $B" + newR + ", '計算ドリル記録'!$C:$C, $C" + newR + ")",
        "=IF($E" + newR + ">0, IFERROR(TEXT(MAXIFS('計算ドリル記録'!$A:$A, '計算ドリル記録'!$B:$B, $B" + newR + ", '計算ドリル記録'!$C:$C, $C" + newR + "), \"yyyy-mm-dd hh:mm:ss\"), \"\"), \"\")"
      ]);
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
    '所要時間(秒)', '間違えた回数', 'セッションID', '日付(検索用)'
  ];

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, 12).setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // 既存シートのヘッダーが古いまたはずれている場合は最新12項目に上書き修復
    sheet.getRange(1, 1, 1, 12).setValues([headers]);
    sheet.getRange(1, 1, 1, 12).setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold');
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
 * - ヘッダーを正しい12項目に更新
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
 */
function setupDailySummarySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = '日別集計';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  // 1. コントロール部 (日付選択 ＆ クラス選択)
  sheet.getRange('A1').setValue('📅 集計日付:').setFontWeight('bold');
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  sheet.getRange('B1').setValue(todayStr).setNumberFormat('@').setBackground('#fef3c7').setFontWeight('bold');

  sheet.getRange('C1').setValue('🏫 クラス:').setFontWeight('bold');
  sheet.getRange('D1').setValue('5年1組').setBackground('#fef3c7').setFontWeight('bold');

  var classRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['5年1組', '5年2組', '5年3組', '5年4組', '5年5組', '5年6組'], true)
    .build();
  sheet.getRange('D1').setDataValidation(classRule);

  sheet.getRange('E1').setValue('※黄色いセル（日付・クラス）を変更すると自動で再集計されます').setFontColor('#64748b').setFontSize(9);

  // 2. 表ヘッダー
  var headers = [
    '出席番号', 'ニックネーム', '解いた問題数', '学習時間(分)',
    '平均解答時間(秒)', '間違えた回数(合計)', '1発正解数', '1発正解率'
  ];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers])
    .setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(3);

  // 3. 各出席番号（1〜45番）の数式設定
  var formulaRows = [];
  for (var num = 1; num <= 45; num++) {
    var row = num + 3; // 行番号 (4〜48)
    formulaRows.push([
      num, // A列: 番号
      // B列: ニックネーム
      '=IFERROR(INDEX(児童名簿!$D:$D, MATCH(1, (児童名簿!$B:$B=$D$1)*(児童名簿!$C:$C=' + num + '), 0)), "-")',
      // C列: 解いた問題数
      '=COUNTIFS(計算ドリル記録!$L:$L, $B$1, 計算ドリル記録!$B:$B, $D$1, 計算ドリル記録!$C:$C, ' + num + ')',
      // D列: 学習時間(分)
      '=IF(C' + row + '=0, 0, ROUND(SUMIFS(計算ドリル記録!$I:$I, 計算ドリル記録!$L:$L, $B$1, 計算ドリル記録!$B:$B, $D$1, 計算ドリル記録!$C:$C, ' + num + ')/60, 1))',
      // E列: 平均解答時間(秒)
      '=IF(C' + row + '=0, "-", ROUND(SUMIFS(計算ドリル記録!$I:$I, 計算ドリル記録!$L:$L, $B$1, 計算ドリル記録!$B:$B, $D$1, 計算ドリル記録!$C:$C, ' + num + ')/C' + row + ', 0))',
      // F列: 間違えた回数
      '=IF(C' + row + '=0, "-", SUMIFS(計算ドリル記録!$J:$J, 計算ドリル記録!$L:$L, $B$1, 計算ドリル記録!$B:$B, $D$1, 計算ドリル記録!$C:$C, ' + num + '))',
      // G列: 1発正解数
      '=IF(C' + row + '=0, "-", COUNTIFS(計算ドリル記録!$L:$L, $B$1, 計算ドリル記録!$B:$B, $D$1, 計算ドリル記録!$C:$C, ' + num + ', 計算ドリル記録!$J:$J, 0))',
      // H列: 1発正解率
      '=IF(C' + row + '=0, "-", TEXT(G' + row + '/C' + row + ', "0.0%"))'
    ]);
  }
  sheet.getRange(4, 1, 45, headers.length).setValues(formulaRows);

  // 4. クラス平均行 (49行目)
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

  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 130);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(8, 110);
  sheet.getRange(4, 1, 46, headers.length).setHorizontalAlignment('center');
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

  // --- 3行目: テーブルヘッダー ---
  var headers = [
    '解いた順番', '記録日時', '問題式', '単元分類',
    '正解', '所要時間(秒)', '間違えた回数', '結果(1発/ミス)'
  ];
  sheet.getRange(3, 1, 1, headers.length).setValues([headers])
    .setBackground('#1e40af').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(3);

  // --- 4行目以降: 自動抽出数式 ---
  // QUERY式: クラス、出席番号(全員対応)、単元分類(部分一致対応)の3条件を完全網羅
  var queryFormula = '=IFERROR(QUERY(計算ドリル記録!A2:L, "SELECT A, E, G, H, I, J WHERE B = \'" & $B$1 & "\' " & IF($D$1="全員", "", " AND C = " & $D$1) & IF($H$1="すべて（全単元）", "", IF($H$1="約分あり", " AND G CONTAINS \'約分\'", " AND G CONTAINS \'" & $H$1 & "\'")) & " ORDER BY A ASC", 0), "")';
  sheet.getRange('B4').setFormula(queryFormula);

  // A列: 解いた順番 (第 1 問, 第 2 問...)
  sheet.getRange('A4').setFormula('=ARRAYFORMULA(IF(ISBLANK(B4:B), "", "第 " & (ROW(B4:B)-3) & " 問"))');

  // H列: 結果 (○ 1発ヒット / × N回空振り)
  sheet.getRange('H4').setFormula('=ARRAYFORMULA(IF(ISBLANK(B4:B), "", IF(G4:G=0, "○ 1発ヒット", "× " & G4:G & "回空振り")))');

  // 列幅設定
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 155);
  sheet.setColumnWidth(3, 140);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 90);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 110);
  sheet.setColumnWidth(8, 120);

  // 書式
  sheet.getRange('F4:F').setNumberFormat('#,##0');
  sheet.getRange('G4:G').setNumberFormat('#,##0');

  // --- 📈 複合グラフの自動生成（所要時間 ＆ エラー率・ミスの可視化） ---
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

  return { status: 'success', sheet: sheetName };
}
