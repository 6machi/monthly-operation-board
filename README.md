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
- 見積もり時間と納期から逆算して、毎日のタスクに分けて追加できます。


## v34
- calendar.js の構文エラー対策とキャッシュ回避を追加。


## v66
- 今日のタイムライン開始時刻は、睡眠/仕事設定より現在時刻の時台を優先します。
