// ============================================================
//  M5Stack Core2 - 最初の動作確認プログラム (Hello)
// ------------------------------------------------------------
//  やること:
//   - 画面に "Hello M5!" と表示する
//   - 画面をタッチするとカウントが増える
//   - 同じ内容をPCのシリアルモニタにも出す
//  これが動けば「書き込み環境 → M5本体」が一通り通った証拠。
//  GPS や WiFi はこの次のステップで足していく。
// ============================================================

#include <M5Unified.h>

int count = 0;

// 画面を描き直す
void draw() {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);

  M5.Display.setTextSize(3);
  M5.Display.setCursor(20, 30);
  M5.Display.println("Hello M5!");

  M5.Display.setCursor(20, 95);
  M5.Display.printf("Taps: %d", count);

  M5.Display.setTextSize(2);
  M5.Display.setCursor(20, 175);
  M5.Display.println("Tap the screen");
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);            // 画面・タッチ・電源などをまとめて初期化
  draw();
  Serial.println("M5Stack Core2 booted. Tap the screen!");
}

void loop() {
  M5.update();             // ボタン/タッチの状態を更新（毎ループ必須）

  auto t = M5.Touch.getDetail();
  if (t.wasPressed()) {    // 画面が「今押された」瞬間だけ true
    count++;
    Serial.printf("tap! count=%d\n", count);
    draw();
  }

  delay(10);
}
