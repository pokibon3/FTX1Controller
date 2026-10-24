# FTX-1 Controller

Yaesu FTX-1 を Chrome から操作する CAT / USB オーディオ コントローラ。
FTX-1 のフロントパネル（MAIN/SUB 2バンド表示、AF-FFT、FUNC ノブ、メインダイヤル）を模した UI です。

- **CAT**: Web Serial API（ボーレート自動検出, 8N1）
- **USB オーディオ**: FTX-1 内蔵「USB Audio CODEC」の受信音をPCで再生（AF-FFT/ウォーターフォール表示・録音）、PCマイクからFTX-1へ送信音声。USB の受信音には本体のスケルチがかからないため、「本体のスケルチに連動」（既定 ON）で、FM 系のモードではスケルチが閉じている間 PC の再生音を消す（MAIN = L は本体の BUSY（`RI`）、SUB = R は S メーターと SQL から推定。FM 以外はツマミが RF になるので連動しない）
- **PWA**: Chrome でインストールするとアプリとして独立ウィンドウ起動・オフライン動作
  （旧「Chrome アプリ」は Google により廃止済みのため、後継の PWA 方式で実装）

使い方（インストール〜操作）は [manual.html](manual.html)（アプリ画面右下の「使い方」からも開けます）。

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
   （macOS では `cu.usbserial-XXXXXXXX0` のように末尾 **0** の方 = Enhanced Com Port。末尾 **1** は Standard Com Port（CAT-2）で、CW キーイング・RTS/DTR の PTT 用。違うポートを選ぶと「応答しません」と表示されます）
3. ボーレートは既定で自動検出（38400 / 4800 / 9600 / 19200 / 115200 を `ID;` で順に試行）
4. 左側パネルの USB AUDIO RX/TX で「USB Audio CODEC」を選択（自動選択されます）

左上の **☰** ボタンで USB AUDIO / CW DECODER / SETUP の左側パネルを表示・非表示できます（各セクションは見出しクリックで折りたたみ、状態は保存されます）。画面幅 900px 以下ではオーバーレイ表示になります。

PTT は既定で CAT (`TX1;`)。RTS/DTR 方式にする場合は SETUP で方式を選び、「CWキーイング」ボタンで 2 本目のシリアルポート（POWER で選んだのとは別の `cu.usbserial-…`。Windows では Standard COM Port）を開きます。このポートは CW の直接キーイングにも使います。一度開くと覚えておき、次からは POWER で CAT 接続したときに自動で開きます（「CWキーイング」をもう一度押して閉じると、自動で開くのをやめます）。USB が切れて戻ったときも自動でつなぎ直します。Chrome からは 2 本のどちらが Standard Com Port か区別できない（本体の再起動で CAT 側と入れ替わることがある）ため、キーイングは両方のポートの DTR / RTS を同時に動かします（PC KEYING が効くのは Standard 側だけで、もう一方では使われない線です）。

## 操作

| 操作 | 内容 |
|---|---|
| メインダイヤル | ドラッグ回転（フライホイール付き）/ ホイール。STEP・MHz・FINE で刻み変更（STEP AUTO は本体の KEY/DIAL の SSB/CW・RTTY/PSK・FM DIAL STEP に従う。FM の Auto は 60 MHz 未満 5 kHz / 以上 20 kHz とみなす。AM は 100 Hz） |
| 周波数の桁 | 桁の上でホイール → その桁を増減。選択中VFOの周波数クリック → 直接入力 |
| MAIN / SUB 表示 | クリックで操作VFO切替（`VS`）。モード表示クリックで MODE ページ |
| LCD 下段キー | 実機のスコープ画面と同じ D-MODE（CENTER/CURSOR/FIX）/ 3DSS⇔W/F / MULTI / SCOPE / SPAN / SPEED。D-MODE・3DSS・SPAN・SPEED は本体スコープを CAT（`SS`）で操作、MULTI はアプリの AF-FFT 表示の ON/OFF |
| FUNC ノブ押し | ファンクションメニュー（実機と同じ 3 ページ）。3/3 の SETTING キーで設定メニュー（`EX`、約 400 項目）を開ける。項目を選ぶと下に「初期値に戻す（工場出荷時の値）」ボタンが出て、その項目だけ工場出荷時の値に戻せる（取扱説明書に初期値が載っている 294 項目。載っていない項目は「初期値 不明」） |
| フィルター表示タッチ | WIDTH / SHIFT / NARROW / CONTOUR / APF / NOTCH |
| N/W・MAG 長押し | MODE / BAND 選択 |
| 上部キー | 実機と同じ GM / S-DX / PMG / MAG / N/W と ◢SPLIT / V/M / M▸V。◢ は押す: MAIN⇔SUB 入替（`SV`）・長押し: SPLIT、V/M は押す: `VM`・長押し: メモリー書込（`AM`）、M▸V は押す: `MA`・長押し: メモリーチューン。GM / S-DX / PMG は CAT 非対応 |
| 左右下のノブ | AF / RF / SQL（MAIN・SUB）。押すと AF ⇔ RF（FM 系は SQL）を切替。今の機能はノブ上の文字がオレンジ |
| CAT CONSOLE | SETUP の「CAT CONSOLE を表示」で表示（既定は非表示） |
| TX キー | 押している間送信（SETUP の LATCH でクリック切替）。ダイヤルロックは LCD の VFO メニューの LOCK |
| メーター | 送信中は PO + ALC/SWR/COMP/ID/VDD（クリックで切替） |
| キーボード | ↑↓ 同調（Shift で×10）/ PageUp・Down バンド / Space 送信 |

### CW デコーダ

CW モードのときだけ、CW 受信（左）と CW 送信（右）のパネルが表示されます。CW 受信パネルの **DECODE** で、USB AUDIO RX の受信音をデコードします（[CW Decoder 4](https://github.com/pokibon3/cw_decoder4) の WebAssembly 版を AudioWorklet で実行。ESP32 版と同じ DSP / デコーダ）。
CW 受信パネルは CW Decoder 4 の Web 版と同じ表示・操作です: `US`/`JP`（欧文・和文）、トーンボタン（AUTO = 500〜1000Hz 自動同調 / 手動 600〜1000Hz）、WPM・TONE・Peak・入力レベル（CLIP・実効入力レート）、コピー / クリア、
FFT スペクトラム（クリックでトーン選択・ダブルクリックで全幅）、オシロスコープ（クリックで全幅、時間軸倍率、KEY / ENV / RAW 表示切替、デコード文字が波形に沿って流れる）。入力チャンネル・適応型フィルタ（ノイズ低減、既定 ON）・入力ゲインは左側パネルの CW DECODER で設定します。

CW 送信パネルは上が送信ログ、下が入力欄です。**SEND** か **Enter** で入力欄の文を送信し、送信済みの文字は色が変わって編集できなくなります（緑 = 送信済み、橙 = 送信中）。その先は送信中も編集・追記でき、打ちながら送るキーボードキーヤーとしても使えます。送信が終わる（または STOP）とその行は上のログへ移ります（STOP で途中までになった文字は取り消し線）。速度は入力欄の上のスライダー（本体の KEY SPEED）。
送信は**直接キーイング**です: 本体の CW SETTING → MODE CW → **PC KEYING** を DTR か RTS にし、SETUP の「CWキーイング」で 2 本目のシリアルポート（POWER で選んだのとは別のポート。Windows では Standard COM Port = CAT-2）を開くと、その信号線を縦振り電鍵としてアプリが短点・長点・間隔を刻みます。送信できないときは見出しに「送信不可」が出て、マウスを乗せると理由が出ます。ウインドウを最小化・タブ切替すると送信を止めます（ブラウザがタイマーを遅らせるため）。RTS/DTR を PTT に使っているときは、同じ線はキーイングに使えません。
- **カタカナ（和文）**: ひらがな・半角カナも可（ガ → カ ゛、パ → ハ ゜、小さいッ・ャ などは普通の大きさで）。符号は CW Decoder 4 の和文の表と同じです。欧文と和文が切り替わるところでは、カナの前に **ホレ**、英字の前に **ラタ** を自動で入れます（数字・記号はどちらでも使うので切り替えません。和文・欧文の状態は送信をまたいで覚えています）。全角の英数字・記号は半角に直して送ります。送れない文字（。や漢字など）は無視します。
- **ログ**: 実際に送った形で残ります（半角・カタカナ・ガ → カ゛、自動で入れたホレ / ラタは青、送れなかった文字は出ません）。

安全のため、ウィンドウのフォーカスが外れると PTT は自動解除され、TOT（既定3分）で送信を打ち切ります。

### FT8 / FT4（受信・送信）

DATA-U / DATA-L のとき FT8 パネルが表示され、USB AUDIO RX の受信音を 15 秒ごと（UTC :00 / :15 / :30 / :45）に解読して一覧表示します。
パネルの **FT8 / FT4** ボタンで FT4（7.5 秒周期）に切り替えられます（受信・送信とも。送信周期ボタンは FT4 では 00/15 ⇔ 07/22）。
デコーダは [ft8_lib](https://github.com/kgoba/ft8_lib)（MIT）を WebAssembly 化し、WSJT-X と同じく精密同期・OSD 復号・信号の引き算による 3 パス解読を追加したもの（`wasm/ft8/`、ビルドは `sh wasm/ft8/build.sh`）。テスト録音で WSJT-X の解読結果の 93% を解読します。
PC の時計が ±1 秒以内に合っている必要があります。
FT4 も同じ精密同期・OSD・3 パス引き算で解読し、さらに WSJT-X と同じく 2 / 4 シンボルのコヒーレント復調を使います（合成信号の試験で ft8_lib 単体より約 2.3 dB 弱い信号まで解読、18 局が重なる混雑時の解読率 52% → 69%）。

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
| ダイヤルの刻み | STEP AUTO は本体の DIAL STEP（`EX0306xx`）を読んで合わせる。1 回転あたりのステップ数はアプリ独自（マウス操作用） |
| 画面の明るさ・色など表示設定 | 対象外 |

## ファイル

```
index.html, css/style.css
manual.html    使い方（アプリから開くマニュアル）
js/serial.js   Web Serial（';' 区切りフレーミング）
js/ftx1.js     FTX-1 CAT コマンド・状態管理・ポーリング
js/audio.js    USB オーディオ RX/TX・録音
js/knob.js     ノブ / メインダイヤル
js/scope.js    AF-FFT + ウォーターフォール
js/app.js      UI 配線
js/version.js  アプリのバージョン（ヘッダー表示・SW キャッシュ名）
js/cwdecoder.js  CW デコーダ（RX 音声 → BPF → AudioWorklet）
js/cwview.js     CW 受信パネルの表示（CW Decoder 4 Web 版のステータス・FFT・オシロスコープ）
js/cwsend.js     CW 送信（PC KEYING による直接キーイング、送信済みの表示とログ）
js/cwdec/      cw_decoder4 の worklet + wasm（GPL、出典は js/cwdec/README.md）
sw.js, manifest.webmanifest   PWA
```

## 注意

CAT コマンド仕様は八重洲無線「FTX-1 シリーズ CAT オペレーション リファレンスマニュアル」（2508-C 版, MAIN ファーム Ver.1.08 以上）に準拠。マニュアルは八重洲無線のサイトから入手してください（著作権の都合でリポジトリには含めていません）。
PO/SWR などのメーター換算は近似値です。
WSJT-X などと同時に CAT ポートは開けません（どちらか一方）。
