# M5Stack Core2 開発環境構築手順（VSCode + PlatformIO）

このドキュメントでは、VSCode と PlatformIO を使用して M5Stack Core2 の開発環境を構築する手順を説明します。

---

## 1. 前提条件

- Windows / macOS / Linux PC  
- インターネット接続  
- M5Stack Core2 本体  
- USB Type-C ケーブル  

---

## 2. 必要ドライバのインストール（Windows の場合）

M5Stack Core2 の USB 通信チップはモデルにより CP2104 または CH9102 が使われています。

推奨：M5Stack 公式ドライバパック  
https://docs.m5stack.com/en/download

個別ドライバ  
・CP210x  
https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers  
・CH9102  
https://www.wch.cn/downloads/CH343SER_ZIP.html  

macOS では基本的にドライバ不要ですが、認識されない場合は上記をインストールしてください。

---

## 3. VSCode のインストール

1. VSCode をダウンロード  
   https://code.visualstudio.com/  
2. インストール後に起動します。

---

## 4. PlatformIO 拡張機能のインストール

1. VSCode 左の拡張機能アイコンをクリック  
2. PlatformIO を検索  
3. PlatformIO IDE をインストール  
4. VSCode を再起動します。

---

## 5. 新規プロジェクトの作成

1. VSCode 左のアリのアイコン（PlatformIO）を開く  
2. Quick Access → New Project  
3. 以下を設定  

   ・Project Name: 任意（例：m5core2-project）  
   ・Board: M5Stack-Core2  
   ・Framework: Arduino  
   ・Location: 任意  

4. Finish を押してプロジェクト作成

---

## 6. M5Stack Core2 を PC に接続

1. USB Type-C ケーブルで接続  
2. Windows → デバイスマネージャで COM ポートを確認  
3. macOS / Linux → 以下のように認識されます  

   ・macOS: /dev/tty.usbserial-xxxx  
   ・Linux: /dev/ttyUSB0  

4. Windows が認識しない場合はドライバ未インストールが原因です。

---

## 7. ビルドと書き込み（Upload）

### ビルド  
・左下のチェックアイコン（Build）をクリック  
または PlatformIO: Build  

### 書き込み  
・左下の矢印アイコン（Upload）をクリック  
または PlatformIO: Upload  

書き込み成功後、Core2 は再起動してプログラムが実行されます。

---

## 8. シリアルモニタの使用

1. 左下のコンセントアイコン（Monitor）をクリック  
または PlatformIO: Monitor  
2. monitor_speed と Serial.begin の値が一致していることを確認  

---


## 9. プロジェクト構成

project/  
├─ src/  
│ └─ main.cpp  
├─ include/  
├─ lib/  
├─ test/  
├─ platformio.ini  
└─ .pio/  

## 10. SDカード構成

└── recorder/  
　　├── config.txt  
　　└── data/  
　　　　　└── YYYYMMDD_HHMMSS/  
　　　　　　　　├── IMU.bin  
　　　　　　　　├── GPS.bin  
　　　　　　　　├── ERROR_NET.bin        （送信失敗時のみ）  
　　　　　　　　└── ERROR_STATE.bin      （送信失敗時のみ）  

Config構成
```
wifi <SSID> <PASSWORD>
device_id <DEVICE_ID>
```



