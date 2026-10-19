# FTX-1 Controller

Yaesu FTX-1 を Chrome から操作する CAT / USB オーディオ コントローラ。
FTX-1 のフロントパネル（MAIN/SUB 2バンド表示、AF-FFT、FUNC ノブ、メインダイヤル）を模した UI です。

- **CAT**: Web Serial API（ボーレート自動検出, 8N1）
- **USB オーディオ**: FTX-1 内蔵「USB Audio CODEC」の受信音をPCで再生（AF-FFT/ウォーターフォール表示・録音）、PCマイクからFTX-1へ送信音声
- **PWA**: Chrome でインストールするとアプリとして独立ウィンドウ起動・オフライン動作
  （旧「Chrome アプリ」は Google により廃止済みのため、後継の PWA 方式で実装）

## 起動

**Web 版**: https://pokibon3.github.io/FTX1Controller/ を Chrome で開くだけで使えます（インストール後はオフラインでも起動）。

**ローカル版**:

```sh
./start.command          # http://localhost:8765 を Chrome で開く
```

Finder から `start.command` をダブルクリックでも可。アドレスバー右の「インストール」アイコンでアプリ化できます。
（Web Serial はセキュアコンテキスト必須のため `file://` 直開きでは動きません）

## 接続

1. FTX-1 と PC を USB 接続（2つのシリアルポートが現れます）
2. **CAT** ボタン → CP2105 の 2 ポートのうち CAT 側を選択
   （macOS では `cu.usbserial-XXXXXXXX1` のように末尾 **1** の方。違うポートを選ぶと「応答しません」と表示されます）
3. ボーレートは既定で自動検出（38400 / 4800 / 9600 / 19200 / 115200 を `ID;` で順に試行）
4. 右側パネルの USB AUDIO RX/TX で「USB Audio CODEC」を選択（自動選択されます）

右上の **☰ SETUP** ボタンで USB AUDIO / SETUP の右側パネルを表示・非表示できます（各セクションは見出しクリックで折りたたみ、状態は保存されます）。画面幅 900px 以下ではオーバーレイ表示になります。

PTT は既定で CAT (`TX1;`)。RTS/DTR 方式にする場合は SETUP で方式を選び、「PTTポート選択」で Standard COM Port を開きます。

## 操作

| 操作 | 内容 |
|---|---|
| メインダイヤル | ドラッグ回転（フライホイール付き）/ ホイール。STEP・MHz・FINE で刻み変更 |
| 周波数の桁 | 桁の上でホイール → その桁を増減。選択中VFOの周波数クリック → 直接入力 |
| MAIN / SUB 表示 | クリックで操作VFO切替（`VS`）。モード表示クリックで MODE ページ |
| LCD 下段キー | MODE / BAND / FILTER / RX / TX / CW / CLAR。数値項目はタップで **FUNC ノブ** に割当 |
| 左ノブ | AF / SQL（MAIN・SUB） |
| メーター | 送信中は PO + ALC/SWR/COMP/ID/VDD（クリックで切替） |
| キーボード | ↑↓ 同調（Shift で×10）/ PageUp・Down バンド / Space 送信 |

安全のため、ウィンドウのフォーカスが外れると PTT は自動解除され、TOT（既定3分）で送信を打ち切ります。

## ファイル

```
index.html, css/style.css
js/serial.js   Web Serial（';' 区切りフレーミング）
js/ftx1.js     FTX-1 CAT コマンド・状態管理・ポーリング
js/audio.js    USB オーディオ RX/TX・録音
js/knob.js     ノブ / メインダイヤル
js/scope.js    AF-FFT + ウォーターフォール
js/app.js      UI 配線
js/version.js  アプリのバージョン（ヘッダー表示・SW キャッシュ名）
sw.js, manifest.webmanifest   PWA
```

## 注意

CAT コマンド仕様は八重洲無線「FTX-1 シリーズ CAT オペレーション リファレンスマニュアル」（2508-C 版, MAIN ファーム Ver.1.08 以上）に準拠。マニュアルは八重洲無線のサイトから入手してください（著作権の都合でリポジトリには含めていません）。
CW 送信は FTX-1 にテキスト直接送信コマンドが無いため、本体の CW TEXT メモリー 5 に書き込んで（`KM`）再生（`KY05;`）します。メモリー 5 の内容は上書きされます。
PO/SWR などのメーター換算は近似値です。
WSJT-X などと同時に CAT ポートは開けません（どちらか一方）。
