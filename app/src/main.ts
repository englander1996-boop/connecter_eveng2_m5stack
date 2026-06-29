// M5Stack Core2 の全センサー値を Even G2 のレンズに表示する技術検証アプリ。
//
// データの流れ:
//   M5Stack(SoftAP + WebSocket) ──ws──▶ このアプリ ──even.ts ブリッジ──▶ Even G2(またはシミュレータ)
//
// フェーズ1(シミュレーション): 実機グラスの代わりに EvenHub シミュレータを使う。データは本物の M5。
//   PC を M5 の AP "M5-Sensor" につなぎ、PC 上で Vite+シミュレータを動かすと、
//   アプリが ws://192.168.4.1:81/ で M5 の全センサーを受け、シミュレータのグラス画面に載る。
// フェーズ2(実機アプリ): app.json を足して ehpk にパックし、実機 G2 へ。
//
// グラスは5〜6行しか出せないので、取れる全データを「ページ」に分け、タップ(click)で順送りする。
// 上スクロール(up)で前ページ。ブラウザ preview は全データを一覧表示。

import { createEvenApp, type LensTextLine } from './lib/even'
import { setupPreview } from './lib/preview'
import { createSensor, emptyState, type SensorState } from './lib/sensor'

// M5 を共有 Wi-Fi(テザリング)に載せたときに M5 画面に出た IP。
// M5 が別の IP をもらったら、ここを書き換える。
const WS_URL = 'ws://10.47.72.204:81/'

let sensor: SensorState = emptyState()

// グラス用ページ。タップで順送り。
type Page = 'ACCEL' | 'GYRO' | 'POWER' | 'TOUCH'
const PAGES: Page[] = ['ACCEL', 'GYRO', 'POWER', 'TOUCH']
let pageIdx = 0

const preview = setupPreview({
  title: 'M5 SensorCast → G2',
  subtitle: `WebSocket ${WS_URL} / tap=next page  up=prev`,
  buttons: [
    { id: 'next', label: 'Next page (tap)', onClick: () => nextPage() },
    { id: 'prev', label: 'Prev page (up)', variant: 'secondary', onClick: () => prevPage() },
  ],
})

const app = await createEvenApp()
app.setLogger((l) => preview.log(l))
preview.setStatus(app.connected ? 'Connected (glasses/simulator)' : 'Bridge unavailable (preview only)')

createSensor({
  url: WS_URL,
  log: (l) => preview.log(l),
  onUpdate: (s) => {
    sensor = s
    render()
  },
})

// グラスのジェスチャ ↔ ページ送り(ブラウザのボタンと同じ関数)。
app.on('click', () => nextPage())
app.on('up', () => prevPage())
app.on('down', () => nextPage())

function nextPage(): void {
  pageIdx = (pageIdx + 1) % PAGES.length
  render()
}
function prevPage(): void {
  pageIdx = (pageIdx - 1 + PAGES.length) % PAGES.length
  render()
}

function magnitude(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

function linkLine(): string {
  if (sensor.connected) return `LINK ok  n=${sensor.n}`
  if (sensor.error) return `no link (${sensor.error})`
  return 'connecting M5...'
}

// 1ページぶんのレンズ行(タイトル + 値 + リンク状態)。
function pageLines(page: Page): LensTextLine[] {
  const s = sensor
  const body: string[] = []
  let title = ''
  switch (page) {
    case 'ACCEL':
      title = 'ACCEL (g)'
      body.push(`x ${s.acc.x.toFixed(2)}`)
      body.push(`y ${s.acc.y.toFixed(2)}`)
      body.push(`z ${s.acc.z.toFixed(2)}   |a| ${magnitude(s.acc).toFixed(2)}`)
      break
    case 'GYRO':
      title = 'GYRO (dps)'
      body.push(`x ${s.gyro.x.toFixed(1)}`)
      body.push(`y ${s.gyro.y.toFixed(1)}`)
      body.push(`z ${s.gyro.z.toFixed(1)}   T ${s.imuTemp.toFixed(1)}C`)
      break
    case 'POWER':
      title = 'POWER'
      body.push(`batt ${s.batLevel}%  ${s.charging ? 'CHG' : ''}`)
      body.push(`volt ${s.batMv} mV`)
      body.push(`up ${Math.floor(s.upMs / 1000)}s   ${s.rtc}`)
      break
    case 'TOUCH':
      title = 'TOUCH / RTC'
      body.push(`touches ${s.touch.z}`)
      body.push(`x ${Math.round(s.touch.x)}  y ${Math.round(s.touch.y)}`)
      body.push(`clock ${s.rtc}`)
      break
  }

  const pager = `${title}   [${pageIdx + 1}/${PAGES.length}]`
  const lines: LensTextLine[] = [
    { id: 1, name: 'title', content: pager, x: 8, y: 6, width: 560, height: 44 },
    { id: 2, name: 'b1', content: body[0] ?? '', x: 8, y: 52, width: 560, height: 38 },
    { id: 3, name: 'b2', content: body[1] ?? '', x: 8, y: 88, width: 560, height: 38 },
    { id: 4, name: 'b3', content: body[2] ?? '', x: 8, y: 124, width: 560, height: 38 },
    { id: 5, name: 'link', content: linkLine(), x: 8, y: 170, width: 560, height: 38 },
  ]
  return lines
}

function render(): void {
  const s = sensor

  // ブラウザ preview: 全データを一覧表示
  preview.setContent(
    [
      linkLine(),
      '',
      `ACCEL g   x ${s.acc.x.toFixed(3)}  y ${s.acc.y.toFixed(3)}  z ${s.acc.z.toFixed(3)}  |a| ${magnitude(s.acc).toFixed(3)}`,
      `GYRO dps  x ${s.gyro.x.toFixed(2)}  y ${s.gyro.y.toFixed(2)}  z ${s.gyro.z.toFixed(2)}`,
      `IMU temp  ${s.imuTemp.toFixed(1)} C`,
      `BATT      ${s.batLevel}%   ${s.batMv} mV   ${s.charging ? 'charging' : 'discharging'}`,
      `TOUCH     count ${s.touch.z}   x ${Math.round(s.touch.x)}  y ${Math.round(s.touch.y)}`,
      `RTC       ${s.rtc}`,
      `UPTIME    ${Math.floor(s.upMs / 1000)} s`,
    ].join('\n'),
  )

  // グラス/シミュレータ: 現在ページのみ(幅560 / 行56px刻みの KNOWHOW 目安)
  void app.render(pageLines(PAGES[pageIdx]))
}

render()
