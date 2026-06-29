// ============================================================
//  M5Stack Core2 - SensorCast (STA / all sensors)
// ------------------------------------------------------------
//  やること:
//   - 家の Wi-Fi(secrets.h の WIFI_SSID/WIFI_PASS) に参加する(STA)
//   - WebSocket サーバ(port 81) を起動する
//   - Core2 で取れるデータを ~10Hz で接続中の全クライアントに配信する:
//       加速度(acc) / ジャイロ(gyr) / IMU温度(tmp) /
//       バッテリ[残量%,電圧mV,充電中] (bat) / タッチ[x,y,本数] (tch) /
//       RTC時刻(rtc) / 稼働ms(up)
//   - 画面に 自分の IP / 接続数 / 主要値 を出す
//
//  受け側(スマホの EvenHubアプリ / PCブラウザ / シミュレータ)は
//  M5 と同じ Wi-Fi に居れば、画面に出る ws://<M5のIP>:81/ につないで Even G2 に表示する。
// ============================================================

#include <M5Unified.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
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
  M5.Display.printf("tch %d (%d,%d)\n", touchCnt, touchX, touchY);
  M5.Display.setCursor(10, 200);
  M5.Display.printf("rtc %s\n", rtcStr);
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

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);  // 画面/電源/IMU/RTC/タッチ をまとめて初期化

  connectWifi();

  webSocket.begin();
  webSocket.onEvent(onWsEvent);

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
}

void loop() {
  M5.update();
  webSocket.loop();

  static uint32_t lastSend = 0;
  uint32_t now = millis();
  if (now - lastSend >= 100) {  // 10Hz
    lastSend = now;

    sample();
    sampleNo++;

    char buf[256];
    int n = snprintf(
        buf, sizeof(buf),
        "{\"n\":%lu,\"acc\":[%.3f,%.3f,%.3f],\"gyr\":[%.2f,%.2f,%.2f],"
        "\"tmp\":%.1f,\"bat\":[%d,%d,%d],\"tch\":[%d,%d,%d],"
        "\"rtc\":\"%s\",\"up\":%lu}",
        (unsigned long)sampleNo, ax, ay, az, gx, gy, gz,
        imuTemp, batLevel, batMv, charging, touchX, touchY, touchCnt,
        rtcStr, (unsigned long)now);
    webSocket.broadcastTXT(buf, n);

    draw();
  }
}
