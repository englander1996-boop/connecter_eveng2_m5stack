# HOWTO — M5Stack Core2 のセンサー値を Even G2 に出すまで（ゼロから再現）

このドキュメントは、このリポジトリの成果物（M5Stack のセンサー値を Even G2 のレンズに表示するアプリ）を
**何もない状態から作り直せる**ように、一連の流れをまとめたもの。

- パートA: M5Stack Core2 側（センサーを Wi-Fi で配信する firmware）
- パートB: Even G2 アプリ側（シミュレータで動かす Web アプリ）
- パートC: M5 と アプリをつなぐ
- パートD: 実機 Even G2 へアップロードする（`.ehpk`）

各パートは独立して読めるが、順番どおりに進めると一番つまずきにくい。

---

## 0. 全体像

### やりたいこと

M5Stack Core2 が内蔵センサー（加速度・ジャイロ・IMU温度・バッテリ・タッチ・RTC）を読み、
Wi-Fi 上の WebSocket で配信する。Even G2 向けの Web アプリがそれを受け取り、グラスのレンズに表示する。

### データの流れ

```
┌──────────────┐   Wi-Fi(同一LAN)    ┌────────────────┐   even.ts ブリッジ   ┌──────────────┐
│ M5Stack Core2│  ── WebSocket ──▶  │ Web アプリ(app) │ ── EvenHub SDK ──▶ │ Even G2 /     │
│ ws サーバ:81 │   JSON ~10Hz        │ Vite + TS       │                    │ シミュレータ  │
└──────────────┘                     └────────────────┘                    └──────────────┘
```

ポイント:

- M5 は **STA モード**（自分で AP を立てるのではなく、PC やスマホと同じ Wi-Fi に参加する）。
  M5 は DHCP で IP をもらい、本体画面に `ws://<IP>:81/` を表示する。アプリはその IP につなぐ。
- 通信は素の **WebSocket**。BLE と違い権限まわりの不確実さが無く、ブラウザでも webview でも同じに動く。
- 表示先は「フェーズ1: PC 上のシミュレータ」で確認してから、「フェーズ2: 実機 G2」へ `.ehpk` で配る。

### 必要なもの

| 区分 | 内容 |
| ---- | ---- |
| ハード | M5Stack Core2 本体 / USB Type-C ケーブル / （実機確認するなら）Even G2 グラス |
| ネット | M5・PC（・スマホ）が同じ Wi-Fi に入れる環境。テザリングでも可 |
| PC ソフト | [VSCode](https://code.visualstudio.com/) + PlatformIO 拡張、[Node.js](https://nodejs.org/) v20+ |
| アカウント | 実機配布する場合は Even Hub のアカウント（[hub.evenrealities.com](https://hub.evenrealities.com/)） |

---

## パートA — M5Stack Core2 側（firmware）

### A-1. PlatformIO 環境を作る

詳しい画面手順は [`references/Readme.md`](references/Readme.md) を参照。要点だけ:

1. M5Stack Core2 の USB ドライバ（CP210x または CH9102）を入れる（Windows のみ）。
2. VSCode に「PlatformIO IDE」拡張を入れて再起動する。
3. M5 を USB で接続し、COM ポート番号を確認する（デバイスマネージャ）。

### A-2. まず `hello` で疎通確認（任意だが推奨）

「書き込み環境 → M5 本体」が通っているかを最小プログラムで確認する。
`firmware/hello/` を PlatformIO で開き、Build → Upload。
画面に `Hello M5!` が出てタップでカウントが増えれば OK。

`firmware/hello/platformio.ini` の要点:

```ini
[env:m5stack-core2]
platform = espressif32
board = m5stack-core2
framework = arduino
monitor_speed = 115200
upload_port = COM5            ; ← 自分の COM 番号に合わせる
lib_deps = m5stack/M5Unified  ; 本体制御の公式ライブラリ
```

> 書き込みで `Connecting...` のまま止まるときは、その表示中に本体の電源/リセットを押す。

### A-3. `sensorcast` でセンサーを配信する

`firmware/sensorcast/` が本番の firmware。やっていること（`src/main.cpp`）:

- `secrets.h` の Wi-Fi に STA で参加し、IP を取得して画面に表示する。
- `WebSocketsServer`（ポート 81）を起動する。
- 100ms ごと（10Hz）に全センサーを読み、接続中の全クライアントへ JSON をブロードキャストする。

#### Wi-Fi 情報を設定する

`firmware/sensorcast/src/secrets.h.example` を、同じフォルダの **`secrets.h`** にコピーして書き換える。

```c
#pragma once
#define WIFI_SSID "your-ssid"
#define WIFI_PASS "your-password"
```

> `secrets.h` は手元だけのファイル。リポジトリにはコミットしない（`.gitignore` 済み）。
> テンプレートの `secrets.h.example` だけを共有する。

#### 書き込んで IP を確認する

`firmware/sensorcast/platformio.ini` の `upload_port` を自分の COM に合わせて Build → Upload。
起動すると本体画面に次が出る。**この IP を後でアプリに設定する**。

```
SensorCast
WiFi <SSID>
ws://192.168.x.x:81/     ← この IP
clients 0  n 0
acc ... / gyr ... / bat ... / tch ... / rtc ...
```

### A-4. 配信フォーマット（WebSocket の中身）

10Hz でこのコンパクト JSON が飛んでくる。アプリ側（`sensor.ts`）はこれを解釈する。

```json
{
  "n":   123,                       // 送信連番（増えていれば生きている）
  "acc": [0.01, -0.02, 0.99],       // 加速度 g (x,y,z)
  "gyr": [0.5, -1.2, 0.0],          // 角速度 deg/s (x,y,z)
  "tmp": 28.5,                      // IMU 温度 degC
  "bat": [87, 4012, 0],             // [残量%, 電圧mV, 充電中0/1]
  "tch": [120, 80, 1],              // タッチ [x, y, 本数]
  "rtc": "14:03:27",                // 時刻 HH:MM:SS
  "up":  45200                      // 稼働 ms
}
```

> 新しいセンサーを足したいときは、`main.cpp` の `sample()` と `snprintf` のフォーマット、
> アプリ側 `sensor.ts` の `Wire` 型と `apply()` の両方に同じキーを足す。

---

## パートB — Even G2 アプリ側（シミュレータで動かす）

### B-1. Even Hub のしくみ（3点セット）

Even G2 のアプリは「ただの Web アプリ（HTML/TS）」で、3つの npm パッケージで開発する。

| パッケージ | 役割 |
| ---------- | ---- |
| `@evenrealities/even_hub_sdk` | アプリ ↔ グラスの**ブリッジ SDK**。レンズに文字を描く / タップ等のイベントを受ける |
| `@evenrealities/evenhub-simulator` | PC 上で**グラス画面を再現**するシミュレータ。dev サーバの URL を渡して起動する |
| `@evenrealities/evenhub-cli` | `.ehpk` への**パッケージング**、QR サイドロード、提出を行う CLI（`evenhub` / `eh`） |

レンズの描画は「**テキストコンテナ**を並べる」モデル。座標 (x,y)・幅・高さを持つテキストを
画面（**576 × 136 px** 相当）に配置する。行数は実質 5〜6 行が限界なので、情報はページに分ける。

### B-2. プロジェクトをゼロから作る

このリポジトリの `app/` は次の手順で作れる（既にある場合はこの節は読み飛ばして B-3 へ）。

```sh
mkdir app && cd app
npm init -y
npm install -D typescript vite
npm install @evenrealities/even_hub_sdk
```

最小構成として次を用意する（このリポジトリの実物が見本）:

- `index.html` — `<div id="app">` と `<script type="module" src="/src/main.ts">` だけ。
- `vite.config.ts` — dev サーバを `host: '0.0.0.0'` で公開（スマホ webview から見えるように）、`port: 5241`。
- `tsconfig.json` — `strict` な ESNext/bundler 設定。
- `app.json` — 実機配布用のマニフェスト（B-5 で詳述）。
- `package.json` の scripts:

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5241",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### B-3. ソース構造（このアプリの中身）

`app/src/` は「再利用できる薄いライブラリ（`lib/`）」と「アプリ本体（`main.ts`）」に分かれている。

| ファイル | 役割 | 注意点 |
| -------- | ---- | ------ |
| `lib/even.ts` | **EvenHub SDK の薄いラッパ**。ブリッジ接続（タイムアウト付き）、レンズ描画、イベント（click/double/up/down）の正規化 | グラス未接続でも落ちないよう、接続失敗時は `connected=false` の mock 動作にフォールバックする |
| `lib/sensor.ts` | **M5 からの WebSocket クライアント**。JSON を `SensorState` に取り込む。切断時は2秒間隔で自動再接続 | 既定 URL は `ws://192.168.4.1:81/`。実際は `main.ts` から M5 の IP を渡して上書きする |
| `lib/preview.ts` | **ブラウザ用のデバッグ UI**。状態・全データ一覧・イベントログ・テストボタンを出す | グラスに出ない全データもここで一覧できる |
| `lib/storage.ts` | `localStorage` の薄ラッパ | — |
| `main.ts` | **アプリ本体**。M5 を受けて、ページ（ACCEL/GYRO/POWER/TOUCH）に分けてレンズへ描く | 先頭の `WS_URL` を M5 の IP に合わせる（C-2） |

#### 描画とイベントの要点（`even.ts`）

- **描画**: `render(lines)` に「テキスト行の配列」を渡す。各行は `{id, name, content, x, y, width, height}`。
  最初の描画は `createStartUpPageContainer`、2回目以降は `rebuildPageContainer` を使う（内部で自動切替）。
- **イベント捕捉**: 画面全体（576×136）に `content: ' '` の**不可視テキスト**を 1 枚重ね、
  それに `isEventCapture: 1` を付けてタップ/スクロールの sink にする（**text-capture 方式**）。
  - これは公式リファレンス（even-dev の hello）と同じ方式。List を使う方式だと「上スクロール（up）」が
    初期 index=0 から発火せず詰むので、text-capture にしている。**ここは作り直すとき要注意**。
  - 受け取れるイベント: `click`（タップ）/ `double`（ダブルタップ）/ `up`（上スクロール）/ `down`（下スクロール）。

### B-4. シミュレータで動かす（フェーズ1）

M5 が A-3 まで終わって配信していれば、PC を同じ Wi-Fi につないだ状態で次を実行する。

Windows（同梱の `run.ps1` が Vite とシミュレータをまとめて面倒見る）:

```powershell
cd app
.\run.ps1            # Vite + Even Hub Simulator（グラス画面）
.\run.ps1 -WebOnly   # Vite + ブラウザ（PC で全データを手早く確認）
.\run.ps1 -SimOnly   # シミュレータのみ（Vite は別で起動済みの前提）
```

手動で起動する場合（OS 共通）:

```sh
cd app
npm install
npm run dev          # http://localhost:5241
# 別ターミナルで:
npx @evenrealities/evenhub-simulator http://127.0.0.1:5241/
```

シミュレータのグラス画面にセンサー値が出て、タップでページが進めば成功。
ブラウザ（`-WebOnly`）では全データ一覧とテストボタン（Next/Prev）で動作確認できる。

### B-5. 配布マニフェスト `app.json`

実機配布のときに使う。主なフィールド:

```jsonc
{
  "package_id": "com.yuisho.m5sensor",  // 一意なアプリ ID（逆ドメイン）
  "name": "M5 SensorCast",
  "version": "0.1.0",
  "min_app_version": "2.0.0",           // Even アプリの最低バージョン
  "min_sdk_version": "0.0.7",           // SDK の最低バージョン
  "entrypoint": "index.html",
  "permissions": [
    {
      "name": "network",                // ネットワーク利用の宣言
      "desc": "Receives sensor data ... via WebSocket.",
      "whitelist": [                     // 接続を許可する宛先。M5 の IP に合わせる
        "http://10.47.72.204",
        "ws://10.47.72.204"
      ]
    }
  ],
  "supported_languages": ["en", "ja"]
}
```

> **注意**: `whitelist` に M5 の IP を入れないと、実機では WebSocket 接続がブロックされる。
> M5 の IP が変わったら `app.json` の whitelist と `main.ts` の `WS_URL` の両方を直す（C 参照）。

---

## パートC — M5 と アプリをつなぐ

### C-1. 同じ Wi-Fi に乗せる

M5（A-3 で `secrets.h` に設定した Wi-Fi）と、PC（シミュレータを動かす）または実機グラスを動かすスマホを、
**同じ Wi-Fi / 同じ LAN** に入れる。スマホのテザリングに M5 と PC を相乗りさせる形でもよい。

### C-2. IP を合わせる（ここが一番ハマる）

1. M5 本体画面に出ている IP（例 `192.168.x.x`）を確認する。
2. `app/src/main.ts` の先頭を書き換える。

   ```ts
   const WS_URL = 'ws://<M5のIP>:81/'
   ```

3. 実機配布もするなら `app/app.json` の `permissions[].whitelist` も同じ IP に直す。

> M5 は DHCP なので、再接続や別の Wi-Fi に乗せると IP が変わることがある。
> 値が変わったら 2.（と 3.）を直す。固定したい場合は M5 側で固定 IP を設定する手もある。

### C-3. つながったかの見方

- M5 本体画面の `clients` が 1 以上になる（接続中のクライアント数）。
- アプリ側はリンク状態を `LINK ok n=...`（`n` が増え続ける）で表示する。
  `connecting M5...` のままなら IP/同一 Wi-Fi/ポート81 を疑う。

---

## パートD — 実機 Even G2 へアップロードする

### D-1. まず QR サイドロードで実機確認（ビルド不要）

ホットリロードのまま実機グラスで確認できる。PC で dev サーバを動かしたまま:

```sh
npx @evenrealities/evenhub-cli qr --url "http://<PCのLAN IP>:5241"
# または: npx @evenrealities/evenhub-cli qr -i <PCのIP> -p 5241
```

表示された QR を Even Realities アプリでスキャンすると、実機グラスにアプリが載る。

### D-2. `.ehpk` にパッケージングする（配布物を作る）

確認できたら、公式 CLI で配布用パッケージを作る。

```sh
cd app
npm run build                                       # dist/ を生成
npx @evenrealities/evenhub-cli pack app.json dist   # out.ehpk を生成（既定の出力名）
# 出力名を変える: npx @evenrealities/evenhub-cli pack app.json dist -o myapp.ehpk
# package_id の空き確認: ... pack app.json dist --check
```

- `.ehpk` は先頭マジック `EHPK` の独自バイナリ形式（ただの zip ではない）。
- `npm run build` が出すのは `dist/`（Web 成果物）だけ。`.ehpk` は上の `pack` で別に作る。
- `dist/` と `*.ehpk` はビルド成果物なので `.gitignore` 済み。配布したいときは
  **GitHub Releases に添付**するのがきれい（リポジトリ本体には入れない）。

### D-3. 提出 / インストール

作った `.ehpk` を Even Hub の開発者ポータル（[hub.evenrealities.com](https://hub.evenrealities.com/)）から
アップロード・提出する。最新の CLI / ポータル手順は公式ドキュメントに従う。

---

## トラブルシューティング

| 症状 | 確認すること |
| ---- | ---- |
| M5 が `WiFi connecting...` のまま | `secrets.h` の SSID/PASS、Wi-Fi の電波・2.4GHz 対応 |
| 書き込みが `Connecting...` で止まる | `Connecting...` 表示中に本体リセット押下、`upload_port` の COM 番号、ケーブル/ドライバ |
| アプリが `connecting M5...` のまま | M5 と PC が同一 Wi-Fi か、`WS_URL` の IP、M5 画面の `ws://...:81/` と一致しているか |
| 実機だけ繋がらない（シミュレータは OK） | `app.json` の `whitelist` に M5 の IP（http と ws の両方）が入っているか |
| 上スクロール（前ページ）が効かない | `even.ts` の text-capture 方式（全画面 `isEventCapture:1`）を崩していないか |
| シミュレータが起動しない | Node v20+ か、`npm install` 済みか、dev サーバ（5241）が先に上がっているか |

---

## ゼロから再現する最短手順（まとめ）

```text
A. M5 側
  1) VSCode + PlatformIO、USB ドライバを用意
  2) firmware/hello を Upload して疎通確認（任意）
  3) firmware/sensorcast/src/secrets.h を作成（SSID/PASS）
  4) upload_port を自分の COM に直して Upload
  5) 本体画面の ws://<IP>:81/ を控える

B. アプリ側（シミュレータ）
  6) cd app && npm install
  7) main.ts の WS_URL を控えた IP に書き換え
  8) (Windows) .\run.ps1  /  (共通) npm run dev + evenhub-simulator
  9) シミュレータにセンサー値、タップでページ送りを確認

C. つなぐ
  10) M5・PC を同じ Wi-Fi に / clients が 1、LINK ok を確認

D. 実機 G2
  11) evenhub-cli qr で実機ホットリロード確認
  12) npm run build → evenhub-cli pack app.json dist で out.ehpk
  13) app.json の whitelist を M5 の IP に合わせる
  14) Even Hub ポータルへ提出 / 配布は GitHub Releases に .ehpk 添付
```
