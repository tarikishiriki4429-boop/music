# GitHub Pages 公開手順

1. GitHubで新しいリポジトリを作る。
2. このZIPを展開する。
3. `index.html`、`styles.css`、`app.js`、`README.md`、`DEPLOY.md` をリポジトリ直下へアップロードする。
4. `.nojekyll` と `.gitignore` は隠しファイルですが、PCからアップロードする場合は一緒に入れてください。
5. GitHubの `Settings` → `Pages` を開く。
6. `Source` を `Deploy from a branch` にする。
7. Branch を `main`、Folder を `/(root)` にして保存する。
8. 表示された `https://ユーザー名.github.io/リポジトリ名/` をiPadのSafariで開く。
9. 初回録音時にマイク使用を許可する。

## 録音できない場合

- Safariのサイト設定でマイクが「許可」になっているか確認。
- GitHub PagesのHTTPS URLから開いているか確認。
- ZIP内のHTMLを「ファイル」アプリから直接開く方法では、iPadOS側の制限で直接録音できないことがあります。その場合は音声ファイル取り込みへ切り替わります。
