# connecter_eveng2_m5stack

M5Stack Core2 のセンサー値を **Even G2** のレンズに表示する技術検証プロジェクト。

M5Stack Core2 が内蔵センサー（加速度・ジャイロ・IMU温度・バッテリ・タッチ・RTC・マイク音量）と
外付け GPS ユニットを読み取り、Wi-Fi 上の WebSocket で配信する。
Even G2 向けアプリがそれを受け取り、グラスのレンズに表示する。

> ゼロから一連の流れ（M5 の書き込み → シミュレータ → 実機アップロード）を再現したい場合は
> [`HOWTO.md`](HOWTO.md) を参照。

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

## 配信データ（JSON、~10Hz）

| キー | 内容 |
|------|------|
| `acc` / `gyr` | 加速度 g / 角速度 deg/s |
| `tmp` | IMU 温度 ℃（チップ温度なので気温より数℃高めに出る） |
| `bat` | [残量%, 電圧mV, 充電0/1] |
| `tch` | [x, y, タッチ本数] |
| `rtc` / `up` | 時刻 / 稼働 ms |
| `mic` | [音量レベル0-100, dBFS]。内蔵 PDM マイクの RMS から算出 |
| `gps` | [状態, 緯度, 経度, 高度m, 速度km/h, 衛星数]。状態は 0 がユニット未検出、1 が測位待ち、2 が測位あり |

### GPS ユニットについて

- 対応ハード: GPS/BDS Unit v1.1（AT6668、GROVE ケーブルで **Port A** に接続）。
- 起動時にボーレート（115200 / 9600）と配線を自動判別する。ユニットを挿していなくても動作し、
  その場合 `gps` の状態は 0 のまま配信される。**挿し直したら M5 を再起動**する。
- 測位（fix）には空が見える場所が必要。屋内では「測位待ち（状態 1）」のままになりやすい。
  初回は屋外で数十秒〜数分かかることがある。

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
   >
   > **Wi-Fi は 2.4GHz 必須**。M5Stack Core2（ESP32）は 5GHz に非対応で、5GHz の SSID を指定すると
   > `WiFi connecting...` のまま繋がらない。テザリングを使う場合も 2.4GHz 帯にする。詳細は [`HOWTO.md`](HOWTO.md) の A-3 / C-1 を参照。

2. 書き込みポートを確認する

   `platformio.ini` の `upload_port`（既定 `COM5`）を、自分の環境の COM ポートに合わせる。

3. ビルドして書き込む

   PlatformIO で対象プロジェクト（`hello` または `sensorcast`）を開き、Build → Upload。
   書き込み後、`sensorcast` は本体画面に自分の IP と `ws://<IP>:81/` を表示する。

### app（Even G2）

[Node.js](https://nodejs.org/)（v20+ 推奨）が必要。

```sh
cd app
npm install
```

`app/src/main.ts` の `WS_URL` を、M5Stack 本体画面に表示された IP に書き換える。

```ts
const WS_URL = 'ws://<M5のIP>:81/'
```

### IP が変わったとき（テザリングの入れ直し等）

テザリングを OFF→ON すると M5 の IP はネットワークごと変わる。手で直す代わりに `update-ip.ps1` が使える。
ネットワーク上の M5 を自動で探し、`WS_URL`（main.ts）と whitelist（app.json）を書き換えて `out.ehpk` の再パックまで行う。

```powershell
cd app
.\update-ip.ps1           # 探す → 書き換え → 再パック
.\update-ip.ps1 -NoPack   # 書き換えのみ（シミュレータ/QRサイドロードならこれで十分）
```

このアプリは「**フェーズ1: シミュレータで確認 → フェーズ2: 実機 G2 用に `.ehpk` 化**」の流れで作る。

#### フェーズ1: シミュレータ / ブラウザで確認

Windows では `run.ps1` が Vite と Even Hub Simulator をまとめて起動する。

```powershell
cd app
.\run.ps1            # Vite + Even Hub Simulator（グラス表示）
.\run.ps1 -WebOnly   # Vite + ブラウザ（PC で手早く確認）
.\run.ps1 -SimOnly   # シミュレータのみ（Vite は起動済み前提）
```

PowerShell プロファイルに `run` 関数を登録してあれば、どのディレクトリからでも `run` と打つだけで同じものが起動する（`run -WebOnly` などの引数もそのまま渡る）。登録は各自の `profile.ps1` に次の1行を足す。

```powershell
function run { & 'Y:\connecter_eveng2_m5stack\app\run.ps1' @args }
```

手動で起動する場合:

```sh
npm run dev          # Vite を http://localhost:5241 で起動
npx @evenrealities/evenhub-simulator http://127.0.0.1:5241/
```

#### フェーズ2: 実機 G2 用に `.ehpk` を作る

公式 CLI [`@evenrealities/evenhub-cli`](https://www.npmjs.com/package/@evenrealities/evenhub-cli) でパッケージングする。

```sh
npm run build                                       # dist/ を生成
npx @evenrealities/evenhub-cli pack app.json dist   # out.ehpk を生成（既定の出力名）
# 出力名を変えたい場合: ... pack app.json dist -o myapp.ehpk
```

実機グラスでの確認は QR サイドロードが使える（Even Realities アプリでスキャン）。

```sh
npx @evenrealities/evenhub-cli qr --url "http://<PCのIP>:5241"
```

> `npm run build` は `dist/`（Web 成果物）を出すだけで、`.ehpk` にはならない。`.ehpk` は上記の `evenhub pack` で作る。
> 生成した `dist/` と `*.ehpk` はビルド成果物なので `.gitignore` 済み（配布時は GitHub Releases に添付する想定）。

## 使い方

1. M5Stack と PC（またはスマホの EvenHub アプリ）を同じ Wi-Fi に接続する。
2. M5Stack の `sensorcast` を起動すると、本体画面に IP と接続数が表示される。
3. app を起動して接続すると、センサー値がレンズ（またはシミュレータ）に表示される。
4. グラスは数行しか出せないため、データを `ACCEL / GYRO / TEMP / MIC / GPS / POWER / TOUCH` のページに分け、
   タップで次ページ、上スクロールで前ページに切り替える。

## ライセンス

未定（個人の技術検証プロジェクト）。
