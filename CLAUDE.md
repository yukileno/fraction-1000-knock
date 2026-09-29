# CLAUDE.md

小5「分数のたし算・ひき算」練習アプリ（GitHub Pages 公開）＋ Google スプレッドシート記録（GAS Web アプリ）。
機能と構成は README.md を参照。ここには作業ルールだけを書く。

## 反映（デプロイ）
- 修正の検証（`node --check`・動作確認）が通ったら、**確認なしで反映まで進めてよい**（ユーザー指示）。
  1. `git commit` → `git push origin main`（リポジトリは公開。push した時点で GitHub Pages に反映）
  2. GAS を変えたとき: `clasp push --force` → `clasp deploy -i AKfycbwUudBJc13ECSV4Bz92IgQ_0e2i5Lx7bEPIp4r1oXQcbWW5XTMKlNAyplnbx5wxXKE -d "<説明>"`
     - 必ず既存デプロイIDを指定する（新規デプロイは URL が変わり、児童のアプリが保存できなくなる）
  3. 反映後に `…/exec`（状態確認）と `…/exec?action=get_users` が `success` を返すことを確認する
- JS/CSS を変えたら `index.html` の `?v=` を上げる（Chromebook のキャッシュ対策）。
- 事前確認が必要なもの: スプレッドシートのデータ削除・書き換え（`deduplicate_logs`, `clean_test_rows` など）、force push・履歴の書き換え、新規デプロイ。

## GAS 管理用 API（合言葉方式）
- 調査・修復・集計シート更新などの action（`gas/Code.js` の `ADMIN_ACTIONS`）は、スクリプトプロパティ `ADMIN_TOKEN` と一致する `token` が必要。
- 合言葉の値は各 PC の `~/.keisan_admin_token`（`%USERPROFILE%\.keisan_admin_token`）にある。コマンドではファイルから読む:
  `curl -sL "…/exec?action=refresh_sheets&token=$(cat ~/.keisan_admin_token)"`
- 値をチャット・コミット・ログ・リポジトリに出さない。新しい値で上書きすると他の PC が使えなくなるので作り直さない。
- ファイルが無い PC では、ユーザーに次を案内する: スプレッドシート →「拡張機能」→「Apps Script」→「プロジェクトの設定」→ スクリプトプロパティ `ADMIN_TOKEN` の値をコピー → PowerShell で
  `Get-Clipboard | Set-Content -NoNewline -Encoding ascii "$env:USERPROFILE\.keisan_admin_token"`
- 別の PC では `clasp login` と git の認証もその PC で一度必要。
- 集計シート（日別集計・研究用_学習曲線）の数式更新は `refresh_sheets`（選択値・グラフは保持）。メニュー実行をユーザーに頼まない。

## 児童の個人データ
- スプレッドシート（計算ドリル記録・児童名簿）は児童の個人データ。リポジトリ・コミット・公開ページに入れない。
- 分析はローカルの一時フォルダで行い、報告には名前を出さず出席番号と集計値だけを使う。
- 生データを丸ごと外に返す API は作らない（以前、安全チェックで拒否された）。集計値だけを返す `learning_stats` を使う。
- ニックネームなど外部入力を `innerHTML` に入れるときは必ず `escapeHtml` を通す。

## 研究デザイン（勝手に変えない）
- 練習球は段階0〜8のスモールステップ（`js/fraction.js` の `generateLeveledProblem`、昇降格は `js/app.js`）。
- **計測球**（出題10問に1問・全員共通「帯分数の引き算・約分あり・繰り下がりなし」）は学習曲線の測定用。問題の種類・頻度を変えると第2期（2026-09-30〜）のデータが比較できなくなるので、変更前に必ずユーザーと相談する。
- 第1期（〜2026-09-29）は全員同じミックス出題（記録の O 列が空欄）。
- 答えを表示した問題（P 列「答え表示」）は記録に残すが「1本」には数えない。

## 動作確認のしかた
- `.claude/launch.json`（`npx http-server -p 8765`）でローカル表示し、**先に `localStorage.setItem('keisan_gas_webhook_url_v1','')` で本番への送信を止めてから**試す。終わったら localStorage を消す。
- `?test_user=1` でログインを省略できる（5年1組1番。本番 URL のまま使うとテスト記録が送られるので注意）。
- 分数判定・出題は Node で単体確認できる（`require('./js/fraction.js')`）。
