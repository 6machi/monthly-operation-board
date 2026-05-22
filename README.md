# タスクかんりシート Supabase版 v26 v11

GitHub Pages + Supabase Auth + Supabase Database/RLS で使う分割版です。

## ファイル構成

```text
index.html
style.css
config.example.js
config.js
js/
  app.js
  auth.js
  board.js
  calendar.js
  setup-view.js
  setup.js
  state.js
  supabase-client.js
  tasks.js
  utils.js
sql/
  supabase_setup.sql
```

## 重要

- GitHubに入れていいのは `anon key` または `publishable key` だけです。
- `service_role key` / `secret key` / Database password は絶対にGitHubへ入れないでください。
- SQLは `sql/supabase_setup.sql` の1本だけを使ってください。

## Supabase設定の流れ

1. Supabaseで新規プロジェクトを作る
2. SQL Editorで `sql/supabase_setup.sql` を実行する
3. Authentication > Providers > Email を有効にする
4. Project URL と anon/publishable key を `config.js` に貼る
5. このフォルダをGitHubへアップする
6. GitHub Pagesで公開する
7. サイト上で新規登録/ログインする

## 初回ログイン時

初回ログイン時に、自動で以下が作られます。

- profiles の自分の行
- teams の「個人ボード」
- team_members の自分の管理者行
- category_trees の初期カテゴリ候補



## v18
- カレンダーの過去日はグレーアウトします。
- タスク追加の発生タイプに「毎週」「毎月」を追加しました。
- 既存Supabaseに反映する場合は `sql/supabase_patch_v18_occurrence.sql` をSQL Editorで1回実行してください。


## v22
- 見積もり時間と納期から逆算して、1本のガンチャ予定として追加できます。


## v34
- calendar.js の構文エラー対策とキャッシュ回避を追加。


## v66
- 今日のタイムライン開始時刻は、睡眠/仕事設定より現在時刻の時台を優先します。


## v85 ガンチャ中心UI
- トップページをスプレッドシート風ガンチャとして運用しやすいよう、日付セル内の表示を親タスク行に集約しました。
- 分割タスクは親タスク名を行見出しに出し、セル内では分割番号や短い作業メモを表示します。
- 選択日の予定から「タイムラインへ自動配置」を実行できるようにしました。
- GitHub用ZIPにはSQLを同梱しません。

## v85 ガンチャ予定バー方式
- ガンチャ左端はカテゴリ・グループ・タスク名称を表示します。
- 詳細タスク名は日付部分のバーとして表示します。
- 納期から逆算は、分割タスクを大量作成せず、1本のガンチャ予定として作成します。
- `task_type='gantt_span'` の単発タスクは、開始日〜期限日まで各日のタイムライン対象になります。
- ガンチャのカテゴリ順は、タスク追加ページのカテゴリ管理順を反映します。


## v85 更新メモ
- ガンチャは今日以降だけを表示します。
- 左列は「カテゴリ ＞ グループ ＞ タスク名称」の見え方に寄せました。
- ガンチャのバー名は、メモ欄の先頭行を詳細名として表示できます。
- 旧タスク管理は必要な時だけ開く修正用の位置づけにしました。
- SQLは同梱していません。

## v85 ガンチャの今日始まり修正
- 今月のガンチャは、左端の日付列が必ず今日になります。
- 未来月は1日から表示し、過去月は今日以降の予定なしとして表示します。
- JS/CSSのキャッシュ回避用バージョンを `v85` に更新しました。

## v103 ログイン復旧・画面整理
- ログイン直後に本人アカウントへ戻し、メンバー/棚/タスク読み込みを順番に確認するようにしました。
- `bootstrap_my_board` が一時的に失敗しても、プロフィール/個人ボード/メンバー情報を可能な範囲で復旧します。
- ログイン画面に「ログインし直す」を追加し、ブラウザに残った古いSupabaseセッションをリセットできます。
- 「メンバー別・今月のタスク / 進捗度」パネルを非表示にしました。
- JS/CSSのキャッシュ回避バージョンを v103 に更新しました。
- GitHub用ZIPにSQLは同梱していません。
