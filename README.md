# Kotoba Music v1.7

声や音声ファイルから音程を取り出し、ピアノロール上で編集して曲を作るブラウザ版音楽アプリです。

## ファイル構成

- `index.html` — 画面本体
- `styles.css` — デザイン
- `app.js` — 録音・音程解析・ピアノロール・再生処理
- `.nojekyll` — GitHub Pages向け設定
- `.gitignore` — 不要ファイル除外
- `DEPLOY.md` — GitHub Pages公開手順

## GitHub Pages

このZIPを展開し、中身をリポジトリのルートへアップロードしてください。
`Settings > Pages > Deploy from a branch > main > /(root)` を選択すると公開できます。

マイク録音は HTTPS 上で使うのが最も安定します。GitHub Pages は HTTPS で配信されます。
