// ============================================================
//  M5Stack Core2 - SensorCast (STA / all sensors)
// ------------------------------------------------------------
//  やること:
//   - 家の Wi-Fi(secrets.h の WIFI_SSID/WIFI_PASS) に参加する(STA)
//   - WebSocket サーバ(port 81) を起動する
//   - Core2 で取れるデータを ~10Hz で接続中の全クライアントに配信する:
//       加速度(acc) / ジャイロ(gyr) / IMU温度(tmp) /
//       バッテリ[残量%,電圧mV,充電中] (bat) / タッチ[x,y,本数] (tch) /
//       RTC時刻(rtc) / 稼働ms(up) /
//       マイク音量[レベル%,dBFS] (mic) /
//       GPS[状態,緯度,経度,高度m,速度km/h,衛星数] (gps)
//   - 画面に 自分の IP / 接続数 / 主要値 を出す
//
//  GPS は GROVE 接続の GPS ユニット (GPS/BDS Unit v1.1 = AT6668 など, NMEA) を想定。
//  Port A/B/C × 115200/9600bps を常時巡回して自動検出する。後から挿しても数秒で拾う。
//  見つからない間は gps 状態 0 (unit なし) で配信を続ける。
//  マイクは Core2 内蔵 PDM マイク。スピーカーと I2S を共有するため本ファームでは音は鳴らさない。
//
//  受け側(スマホの EvenHubアプリ / PCブラウザ / シミュレータ)は
//  M5 と同じ Wi-Fi に居れば、画面に出る ws://<M5のIP>:81/ につないで Even G2 に表示する。
// ============================================================

#include <M5Unified.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <TinyGPS++.h>
#include <esp_task_wdt.h>
#include "secrets.h"  // WIFI_SSID / WIFI_PASS (手元だけのファイル)

WebSocketsServer webSocket(81);

int clientCount = 0;
uint32_t sampleNo = 0;

float ax = 0, ay = 0, az = 0;
float gx = 0, gy = 0, gz = 0;
float imuTemp = 0;
int batLevel = 0, batMv = 0, charging = 0;
int touchX = 0, touchY = 0, touchCnt = 0;
char rtcStr[16] = "--:--:--";

// マイク: 内蔵 PDM マイクを 16kHz で短く録り、RMS から音量を出す
// 注意: M5.Mic.record() は録音タスクが詰まると無限に待つため(ループ全体が freeze する)、
// isRecording() を見て空いているときだけ呼ぶ。長く詰まったらドライバを入れ直す。
static constexpr size_t MIC_SAMPLES = 256;
static constexpr uint32_t MIC_RATE = 16000;
int16_t micBuf[MIC_SAMPLES];
float micDb = -120.0f;  // dBFS(フルスケール比)。無音 ≈ -70〜-60、大声 ≈ -10 前後
int micLevel = 0;       // 0-100 の目安レベル(-60dBFS を 0、0dBFS を 100 に線形換算)
uint32_t micLastOkMs = 0;  // 最後に録音が完了していた時刻(詰まり検出用)

// GPS: GROVE ポートの GPS ユニット(NMEA)を TinyGPSPlus で解析
// gpsState: 0 = ユニット未検出 / 1 = ユニットあり・測位待ち / 2 = 測位あり
// どのポート・速度に居ても拾えるよう、候補を非ブロッキングで巡回探索する。
// 後からケーブルを挿しても数秒で自動検出される(再起動不要)。
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
int gpsState = 0;
double gpsLat = 0, gpsLon = 0;
float gpsAlt = 0, gpsKmph = 0;
int gpsSats = 0;

// 受信専用(TX ピンは使わない)なので、候補は「どのピンで NMEA を聞くか」だけ。
struct GpsTry { uint32_t baud; int rx; };
const GpsTry GPS_TRIES[] = {
    // Port A (赤, G32/G33)
    {115200, 32}, {115200, 33}, {9600, 32}, {9600, 33},
    // Port C (青, G13/G14, M5GO Bottom2 等)
    {115200, 13}, {115200, 14}, {9600, 13}, {9600, 14},
    // Port B (黒, G36)
    {115200, 36}, {9600, 36},
};
constexpr int GPS_TRY_COUNT = sizeof(GPS_TRIES) / sizeof(GPS_TRIES[0]);
int gpsTryIdx = -1;
int gpsSweeps = 0;          // 全候補を空振りで何周したか
uint32_t gpsTryStart = 0;   // 今の候補を試し始めた時刻
uint32_t gpsLastByte = 0;   // 最後に受信できた時刻(途絶検出用)

String myIp = "0.0.0.0";

void draw() {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);

  M5.Display.setTextSize(2);
  M5.Display.setCursor(10, 8);
  M5.Display.println("SensorCast");

  M5.Display.setCursor(10, 36);
  M5.Display.printf("WiFi %s\n", WIFI_SSID);
  M5.Display.setCursor(10, 58);
  M5.Display.printf("ws://%s:81/\n", myIp.c_str());
  M5.Display.setCursor(10, 80);
  M5.Display.printf("clients %d  n %lu\n", clientCount, (unsigned long)sampleNo);

  M5.Display.setCursor(10, 112);
  M5.Display.printf("acc %+.2f %+.2f %+.2f\n", ax, ay, az);
  M5.Display.setCursor(10, 134);
  M5.Display.printf("gyr %+.0f %+.0f %+.0f\n", gx, gy, gz);
  M5.Display.setCursor(10, 156);
  M5.Display.printf("bat %d%% %dmV %s\n", batLevel, batMv, charging ? "CHG" : "");
  M5.Display.setCursor(10, 178);
  M5.Display.printf("mic %3d%% %.0fdB  rtc %s\n", micLevel, micDb, rtcStr);
  M5.Display.setCursor(10, 200);
  if (gpsState == 0) {
    M5.Display.printf("gps searching unit...\n");
  } else if (gpsState == 1) {
    M5.Display.printf("gps wait sats %d\n", gpsSats);
  } else {
    M5.Display.printf("gps %.5f %.5f\n", gpsLat, gpsLon);
  }
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      clientCount++;
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("ws[%u] connected from %s\n", num, ip.toString().c_str());
      break;
    }
    case WStype_DISCONNECTED:
      if (clientCount > 0) clientCount--;
      Serial.printf("ws[%u] disconnected\n", num);
      break;
    default:
      break;
  }
}

// 家の Wi-Fi に参加する。つながるまで画面に状況を出す。
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(10, 20);
  M5.Display.printf("WiFi connecting...\n%s", WIFI_SSID);

  int dots = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    M5.Display.print(".");
    Serial.print(".");
    if (++dots > 60) {  // 約24秒で一旦やり直し
      Serial.println("\nretry WiFi.begin");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      dots = 0;
      M5.Display.fillScreen(TFT_BLACK);
      M5.Display.setCursor(10, 20);
      M5.Display.printf("WiFi retry...\n%s", WIFI_SSID);
    }
  }

  myIp = WiFi.localIP().toString();
  Serial.printf("\nWiFi connected. ip=%s\n", myIp.c_str());
}

// 次の候補(ピン×速度)に切り替える。begin は一瞬なので loop を止めない。
// TX は -1(未使用)。こちらから送ることは無いので受信ピンだけ張り替える。
void gpsNextTry() {
  gpsTryIdx = (gpsTryIdx + 1) % GPS_TRY_COUNT;
  if (gpsTryIdx == 0 && gpsSweeps < 1000) gpsSweeps++;
  const GpsTry& t = GPS_TRIES[gpsTryIdx];
  gpsSerial.end();
  gpsSerial.begin(t.baud, SERIAL_8N1, t.rx, -1);
  gpsTryStart = millis();
}

// 毎 loop 呼ぶ。未検出なら NMEA の '$' を探して候補を巡回、
// 検出済みなら受信を TinyGPSPlus に食わせる。5秒途絶したら探索に戻る。
// 3周探して見つからなければ巡回を 10 秒間隔に落とす(UART 再初期化の連打を避ける)。
void gpsPoll() {
  uint32_t now = millis();

  if (gpsState == 0) {
    if (gpsTryIdx < 0) { gpsNextTry(); return; }
    while (gpsSerial.available()) {
      if (gpsSerial.read() == '$') {
        const GpsTry& t = GPS_TRIES[gpsTryIdx];
        gpsState = 1;
        gpsSweeps = 0;
        gpsLastByte = now;
        Serial.printf("GPS found: baud=%lu rx=%d\n", (unsigned long)t.baud, t.rx);
        return;
      }
    }
    uint32_t dwellMs = (gpsSweeps >= 3) ? 10000 : 1500;
    if (now - gpsTryStart > dwellMs) gpsNextTry();
    return;
  }

  bool got = false;
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
    got = true;
  }
  if (got) gpsLastByte = now;
  if (now - gpsLastByte > 5000) {  // 抜かれた/電源断とみなして探索に戻る
    Serial.println("GPS silent 5s -> re-probe");
    gpsState = 0;
    gpsTryStart = now;
  }
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);  // 画面/電源/IMU/RTC/タッチ をまとめて初期化

  M5.Mic.begin();  // 内蔵 PDM マイク(スピーカーとは排他)

  connectWifi();

  webSocket.begin();
  webSocket.onEvent(onWsEvent);
  // 死にかけのクライアントに送信が引っ張られないよう、ping/pong で自動切断する
  webSocket.enableHeartbeat(15000, 3000, 2);

  // 番犬: loop が 10 秒止まったら自動リブートして自己復旧する
  esp_task_wdt_init(10, true);
  esp_task_wdt_add(NULL);

  draw();
}

void sample() {
  M5.Imu.getAccel(&ax, &ay, &az);
  M5.Imu.getGyro(&gx, &gy, &gz);
  M5.Imu.getTemp(&imuTemp);

  batLevel = M5.Power.getBatteryLevel();
  batMv = M5.Power.getBatteryVoltage();
  charging = (M5.Power.isCharging() == m5::Power_Class::is_charging_t::is_charging) ? 1 : 0;

  touchCnt = (int)M5.Touch.getCount();
  if (touchCnt > 0) {
    auto t = M5.Touch.getDetail(0);
    touchX = t.x;
    touchY = t.y;
  }

  auto dt = M5.Rtc.getDateTime();
  snprintf(rtcStr, sizeof(rtcStr), "%02d:%02d:%02d",
           dt.time.hours, dt.time.minutes, dt.time.seconds);

  // マイク: 録音が完了しているときだけ、完了ぶんを集計して次を仕掛ける。
  // 録音中に record() を呼ぶと完了待ちでブロックするので絶対に呼ばない。
  // ここで読む値は最大 1 周期(100ms)前の音。レベルメータ用途には十分。
  if (M5.Mic.isEnabled()) {
    uint32_t now = millis();
    if (!M5.Mic.isRecording()) {
      uint64_t sum = 0;
      for (size_t i = 0; i < MIC_SAMPLES; i++) {
        sum += (int32_t)micBuf[i] * (int32_t)micBuf[i];
      }
      float rms = sqrtf((float)sum / MIC_SAMPLES);
      micDb = 20.0f * log10f((rms < 1.0f ? 1.0f : rms) / 32768.0f);
      int lvl = (int)((micDb + 60.0f) * (100.0f / 60.0f));
      micLevel = lvl < 0 ? 0 : (lvl > 100 ? 100 : lvl);
      micLastOkMs = now;
      M5.Mic.record(micBuf, MIC_SAMPLES, MIC_RATE);
    } else if (now - micLastOkMs > 5000) {
      // 録音タスクが詰まっている。ドライバを入れ直して自己修復する。
      Serial.println("mic stuck 5s -> restart mic driver");
      M5.Mic.end();
      M5.Mic.begin();
      micLastOkMs = now;
    }
  }

  // GPS: 受信は gpsPoll() が毎 loop やっているので、ここでは最新値の反映だけ
  if (gpsState > 0) {
    gpsSats = gps.satellites.isValid() ? (int)gps.satellites.value() : 0;
    if (gps.location.isValid()) {
      gpsState = 2;
      gpsLat = gps.location.lat();
      gpsLon = gps.location.lng();
      gpsAlt = gps.altitude.isValid() ? (float)gps.altitude.meters() : 0;
      gpsKmph = gps.speed.isValid() ? (float)gps.speed.kmph() : 0;
    } else {
      gpsState = 1;
    }
  }
}

void loop() {
  esp_task_wdt_reset();
  M5.update();
  webSocket.loop();
  gpsPoll();

  static uint32_t lastSend = 0;
  uint32_t now = millis();
  if (now - lastSend >= 100) {  // 10Hz
    lastSend = now;

    sample();
    sampleNo++;

    char buf[384];
    int n = snprintf(
        buf, sizeof(buf),
        "{\"n\":%lu,\"acc\":[%.3f,%.3f,%.3f],\"gyr\":[%.2f,%.2f,%.2f],"
        "\"tmp\":%.1f,\"bat\":[%d,%d,%d],\"tch\":[%d,%d,%d],"
        "\"rtc\":\"%s\",\"up\":%lu,"
        "\"mic\":[%d,%.1f],"
        "\"gps\":[%d,%.6f,%.6f,%.1f,%.1f,%d]}",
        (unsigned long)sampleNo, ax, ay, az, gx, gy, gz,
        imuTemp, batLevel, batMv, charging, touchX, touchY, touchCnt,
        rtcStr, (unsigned long)now,
        micLevel, micDb,
        gpsState, gpsLat, gpsLon, gpsAlt, gpsKmph, gpsSats);
    webSocket.broadcastTXT(buf, n);

    draw();
  }
}
