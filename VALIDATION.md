# v3.1 検証記録

今回追加した合成音テスト9件を通過：80ms音階、60ms半音階の上昇・下降、80ms間隔の2オクターブ往復、120ms間隔の3オクターブ往復、低音100ms、倍音の強い跳躍、高音への跳躍、短い中間の実音の保持。
旧版の合成音回帰テスト21件も通過。
ブラウザで、高速音階・2オクターブの往復、追従モード切替後の再変換、設定と録音の再読込、縦並びの配置を確認。

v3.0で再現した症状：60ms音階の音抜け、80msの2オクターブ往復が低音に固定される問題。高速追従では全音程を検出。これらのテスト音における開始位置の誤差は45ms未満。

これは合成音による結果です。ユーザーの実録音を使った認識率の測定とiPad/Safari実機検証は未実施です。

実行：`node tests/fast-tracking.test.cjs`、`node tests/pitch.test.cjs`

以下は前版の検証記録です。

# v3.0 検証記録

合成音解析：21ケース＋サンプルレート・長時間の6ケースを通過。
ブラウザ機能：15項目を通過。未捕捉JavaScriptエラー0件。

検証ブラウザ：Chromium。画面幅1180・1024・820・390pxで確認。
実際のiPad/Safariと人間の歌声の検証は未実施。録音処理は合成マイク入力で確認。

## 長時間検証

5分の連続音を300秒まで認識。作業環境での解析時間23.3秒。実機での所要時間は異なります。
5分のボイス＋8拍の開始位置を含む出力：304.9秒。途中打切りなし。

## ブラウザで確認した操作

- add/delete/undo/redo
- double click
- touch double tap
- drag pitch/time
- worker pitch conversion
- record start offset
- unquantized timing
- IndexedDB recording reload
- project audio backup/import
- WAV export
- compatibility playback
- recorder lifecycle / track ownership
- analysis cancellation / reconversion
- landscape/portrait/phone layout

## 再実行

`node tests/pitch.test.cjs` で単音・倍音・半音移動・中間音・OFF時の短音・再発音・ビブラート・小音量・ノイズ・オクターブ移動を検証できます。追加のパッケージは不要です。
