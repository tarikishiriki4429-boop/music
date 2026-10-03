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
