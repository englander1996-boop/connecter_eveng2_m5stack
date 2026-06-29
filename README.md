# connecter_eveng2_m5stack

M5Stack Core2 のセンサー値を **Even G2** のレンズに表示する技術検証プロジェクト。

M5Stack Core2 が内蔵センサー（加速度・ジャイロ・IMU温度・バッテリ・タッチ・RTC）を読み取り、
Wi-Fi 上の WebSocket で配信する。Even G2 向けアプリがそれを受け取り、グラスのレンズに表示する。

## データの流れ

```
M5Stack Core2                Even G2 アプリ              Even G2 グラス
(WebSocket サーバ)  ──ws──▶  (app / even.ts ブリッジ) ──▶ (またはシミュレータ)
 内蔵センサーを                受信して整形・                レンズに表示
 ~10Hz で配信                 ページ切り替え
```

## ディレクトリ構成

```
.
├─ firmware/          M5Stack Core2 ファームウェア（PlatformIO）
│  ├─ hello/          画面表示＋タッチ数えの最小動作確認
│  └─ sensorcast/     全センサー値を WebSocket(port 81) で配信
├─ app/              Even G2 向けアプリ（TypeScript + Vite + EvenHub SDK）
└─ references/       開発環境構築手順（VSCode + PlatformIO）
```

## セットアップ

### firmware（M5Stack Core2）

[PlatformIO](https://platformio.org/)（VSCode 拡張）が必要。詳しい手順は [`references/Readme.md`](references/Readme.md) を参照。

1. Wi-Fi 接続情報を設定する（`sensorcast` のみ）

   `firmware/sensorcast/src/secrets.h.example` を同じフォルダの `secrets.h` にコピーし、
   自分の Wi-Fi の SSID とパスワードに書き換える。

   ```c
   #define WIFI_SSID "your-ssid"
   #define WIFI_PASS "your-password"
   ```

   > `secrets.h` は手元だけのファイル。リポジトリにはコミットしない（`.gitignore` 済み）。

2. 書き込みポートを確認する

   `platformio.ini` の `upload_port`（既定 `COM5`）を、自分の環境の COM ポートに合わせる。

3. ビルドして書き込む

   PlatformIO で対象プロジェクト（`hello` または `sensorcast`）を開き、Build → Upload。
   書き込み後、`sensorcast` は本体画面に自分の IP と `ws://<IP>:81/` を表示する。

### app（Even G2）

[Node.js](https://nodejs.org/) が必要。

```sh
cd app
npm install
npm run dev      # http://localhost:5241 で起動
```

`app/src/main.ts` の `WS_URL` を、M5Stack 本体画面に表示された IP に書き換える。

```ts
const WS_URL = 'ws://<M5のIP>:81/'
```

ビルドして EvenHub パッケージ（`.ehpk`）を作る場合:

```sh
npm run build
```

## 使い方

1. M5Stack と PC（またはスマホの EvenHub アプリ）を同じ Wi-Fi に接続する。
2. M5Stack の `sensorcast` を起動すると、本体画面に IP と接続数が表示される。
3. app を起動して接続すると、センサー値がレンズ（またはシミュレータ）に表示される。
4. グラスは数行しか出せないため、データを `ACCEL / GYRO / POWER / TOUCH` のページに分け、
   タップで次ページ、上スクロールで前ページに切り替える。

## ライセンス

未定（個人の技術検証プロジェクト）。
