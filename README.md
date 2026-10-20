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
2. **POWER** ボタン（電源を入れる = CAT 接続）→ CP2105 の 2 ポートのうち CAT 側を選択
   （macOS では `cu.usbserial-XXXXXXXX1` のように末尾 **1** の方。違うポートを選ぶと「応答しません」と表示されます）
3. ボーレートは既定で自動検出（38400 / 4800 / 9600 / 19200 / 115200 を `ID;` で順に試行）
4. 左側パネルの USB AUDIO RX/TX で「USB Audio CODEC」を選択（自動選択されます）

左上の **☰** ボタンで USB AUDIO / CW DECODER / SETUP の左側パネルを表示・非表示できます（各セクションは見出しクリックで折りたたみ、状態は保存されます）。画面幅 900px 以下ではオーバーレイ表示になります。

PTT は既定で CAT (`TX1;`)。RTS/DTR 方式にする場合は SETUP で方式を選び、「PTTポート選択」で Standard COM Port を開きます。

## 操作

| 操作 | 内容 |
|---|---|
| メインダイヤル | ドラッグ回転（フライホイール付き）/ ホイール。STEP・MHz・FINE で刻み変更 |
| 周波数の桁 | 桁の上でホイール → その桁を増減。選択中VFOの周波数クリック → 直接入力 |
| MAIN / SUB 表示 | クリックで操作VFO切替（`VS`）。モード表示クリックで MODE ページ |
| LCD 下段キー | 実機のスコープ画面と同じ D-MODE（CENTER/CURSOR/FIX）/ 3DSS⇔W/F / MULTI / SCOPE / SPAN / SPEED。D-MODE・3DSS・SPAN・SPEED は本体スコープを CAT（`SS`）で操作、MULTI はアプリの AF-FFT 表示の ON/OFF |
| FUNC ノブ押し | ファンクションメニュー（実機と同じ 3 ページ）。3/3 の SETTING キーで設定メニュー（`EX`、約 400 項目）を開ける |
| フィルター表示タッチ | WIDTH / SHIFT / NARROW / CONTOUR / APF / NOTCH |
| N/W・MAG 長押し | MODE / BAND 選択 |
| 上部キー | 実機と同じ GM / S-DX / PMG / MAG / N/W と ◢SPLIT / V/M / M▸V。◢ は押す: MAIN⇔SUB 入替（`SV`）・長押し: SPLIT、V/M は押す: `VM`・長押し: メモリー書込（`AM`）、M▸V は押す: `MA`・長押し: メモリーチューン。GM / S-DX / PMG は CAT 非対応 |
| 左ノブ | AF / SQL（MAIN・SUB） |
| CAT CONSOLE | SETUP の「CAT CONSOLE を表示」で表示（既定は非表示） |
| TX キー | 押している間送信（SETUP の LATCH でクリック切替）。ダイヤルロックは LCD の VFO メニューの LOCK |
| メーター | 送信中は PO + ALC/SWR/COMP/ID/VDD（クリックで切替） |
| キーボード | ↑↓ 同調（Shift で×10）/ PageUp・Down バンド / Space 送信 |

### CW デコーダ

CW モードのときだけ、CW 送信（左）と CW 受信（右）のパネルが表示されます。CW 受信パネルの **DECODE** で、USB AUDIO RX の受信音をデコードします（[CW Decoder 4](https://github.com/pokibon3/cw_decoder4) の WebAssembly 版を AudioWorklet で実行。ESP32 版と同じ DSP / デコーダ）。
`US`/`JP` で欧文・和文、トーンボタンで AUTO（500〜1000Hz 自動同調）と手動 600〜1000Hz を切り替えます。入力チャンネル・入力ゲインは左側パネルの CW DECODER で設定します。

安全のため、ウィンドウのフォーカスが外れると PTT は自動解除され、TOT（既定3分）で送信を打ち切ります。

### FT8（受信・送信）

DATA-U / DATA-L のとき FT8 パネルが表示され、USB AUDIO RX の受信音を 15 秒ごと（UTC :00 / :15 / :30 / :45）に解読して一覧表示します。
デコーダは [ft8_lib](https://github.com/kgoba/ft8_lib)（MIT）を WebAssembly 化し、WSJT-X と同じく精密同期・OSD 復号・信号の引き算による 3 パス解読を追加したもの（`wasm/ft8/`、ビルドは `sh wasm/ft8/build.sh`）。テスト録音で WSJT-X の解読結果の 93% を解読します。
PC の時計が ±1 秒以内に合っている必要があります。

送信は WSJT-X と同じ Tx1〜Tx6（呼び出し / レポート / R+レポート / RR73 / 73 / CQ）:

1. MY CALL と GRID を入力（保存されます）
2. 一覧の行をクリック → その局が DX CALL に入り、レポート（その局の S/N）と送信周期（相手と逆の :00/:30 か :15/:45）が設定されます。ダブルクリックでそのまま TX ON。CQ を出すときは Tx6 を選んで TX ON
3. **TX ON** の間、選択中の Tx を毎周期送信。**AUTO SEQ** で相手の応答に合わせて Tx を進め、73 の送信（または相手の 73 受信）で TX OFF。**HALT** で即停止

送信は DATA-U のみ。周期の頭で PTT（SETUP の方式）を入れ、0.5 秒から GFSK 音声（12.64 秒、TX Hz の位置、LEVEL の振幅）を USB AUDIO TX に出し、終わると PTT を切ります（USB AUDIO TX は自動で開始）。本体側は DATA モードの入力を USB にしておいてください。ALC が振れない程度に LEVEL / 本体の DATA MOD GAIN を調整します。
同じメッセージを 10 回続けて送ると TX OFF（WSJT-X の Tx watchdog 相当）。PTT キー・TOT・ウインドウ最小化（タブ切替）でも送信を止めて TX OFF にします（他のウインドウへのフォーカス移動では止めません）。

## 本体との連動

接続中は次の項目を本体と双方向に連動します（本体側で変えるとアプリにも反映）:
周波数・モード・VFO/メモリー表示（`IF`/`OI`）・FUNC ツマミの機能（`SF`）・FINE/FAST（`FN`）・送信メーターの種類（`MS`）・
QMB（`QI`/`QR`）・BUSY/HI-SWR/チューニング中（`RI`）・モニター ON/OFF とレベル（`ML`）・本体スコープの表示モード/スパン/スピード（`SS`）ほか。

### CAT コマンドが無く、本体と連動できないもの

| 項目 | アプリでの扱い |
|---|---|
| DISP（画面レイアウト） | アプリの表示だけを切り替え |
| SCOPE MAIN/SUB | 操作する VFO（`VS`）の切替で代用 |
| MULTI（オシロスコープ / AF-FFT 表示） | アプリの AF-FFT 表示の ON/OFF |
| GM / S-DX / PMG キー | 操作不可（押すと「CAT では操作できません」） |
| SUB 側の BUSY ランプ | `RI` は MAIN 側のみのため、SUB は S メーターから推定 |
| ダイヤルの刻み | アプリ独自（本体のメニュー `EX` の DIAL STEP とは別） |
| 画面の明るさ・色など表示設定 | 対象外 |

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
js/cwdecoder.js  CW デコーダ（RX 音声 → BPF → AudioWorklet）
js/cwdec/      cw_decoder4 の worklet + wasm（GPL、出典は js/cwdec/README.md）
sw.js, manifest.webmanifest   PWA
```

## 注意

CAT コマンド仕様は八重洲無線「FTX-1 シリーズ CAT オペレーション リファレンスマニュアル」（2508-C 版, MAIN ファーム Ver.1.08 以上）に準拠。マニュアルは八重洲無線のサイトから入手してください（著作権の都合でリポジトリには含めていません）。
CW 送信は FTX-1 にテキスト直接送信コマンドが無いため、本体の CW TEXT メモリー 5 に書き込んで（`KM`）再生（`KY05;`）します。メモリー 5 の内容は上書きされます。
PO/SWR などのメーター換算は近似値です。
WSJT-X などと同時に CAT ポートは開けません（どちらか一方）。
