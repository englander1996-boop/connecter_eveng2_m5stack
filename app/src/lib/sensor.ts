// M5Stack(Wi-Fi + WebSocket)から全センサー値を受け取るクライアント。
// M5 側 firmware/sensorcast が ws://192.168.4.1:81/ で ~10Hz 配信してくる:
//   {"n":連番,"acc":[ax,ay,az],"gyr":[gx,gy,gz],"tmp":IMU温度,
//    "bat":[残量%,電圧mV,充電0/1],"tch":[x,y,本数],"rtc":"HH:MM:SS","up":稼働ms}
//
// 設計メモ:
// - 受け側(PCブラウザ / EvenHubシミュレータ / Android webview)は M5 の AP "M5-Sensor" に
//   つないでいる前提。同じ AP 上なら 192.168.4.1 が M5 本体。
// - 切断時は自動再接続(2秒間隔)。M5 の電源入れ直しでも勝手に復帰する。
// - WebSocket は webview でもブラウザでも素のまま使える(BLE と違い権限・対応の不確実さが無い)。

export type Vec3 = { x: number; y: number; z: number }

export type SensorState = {
  connected: boolean
  n: number          // M5 側の送信連番(増えていれば生きている)
  acc: Vec3          // 加速度 g
  gyro: Vec3         // 角速度 deg/s
  imuTemp: number    // IMU温度 degC
  batLevel: number   // バッテリ残量 %
  batMv: number      // バッテリ電圧 mV
  charging: boolean  // 充電中
  touch: Vec3        // x, y, z=本数(count)
  rtc: string        // 時刻 HH:MM:SS
  upMs: number       // M5 稼働時間 ms
  error: string | null
}

export type SensorOptions = {
  onUpdate: (s: SensorState) => void
  url?: string          // 既定 ws://192.168.4.1:81/
  log?: (line: string) => void
  reconnectMs?: number  // 再接続間隔(既定 2000ms)
}

export type Sensor = {
  getState(): SensorState
  close(): void
}

export function emptyState(): SensorState {
  return {
    connected: false,
    n: 0,
    acc: { x: 0, y: 0, z: 0 },
    gyro: { x: 0, y: 0, z: 0 },
    imuTemp: 0,
    batLevel: 0,
    batMv: 0,
    charging: false,
    touch: { x: 0, y: 0, z: 0 },
    rtc: '--:--:--',
    upMs: 0,
    error: null,
  }
}

// M5 のコンパクト JSON を SensorState に取り込む(欠けたフィールドは前回値を保つ)。
type Wire = {
  n?: number
  acc?: number[]
  gyr?: number[]
  tmp?: number
  bat?: number[]
  tch?: number[]
  rtc?: string
  up?: number
}

function vec(arr: number[] | undefined, prev: Vec3): Vec3 {
  if (!Array.isArray(arr)) return prev
  return {
    x: typeof arr[0] === 'number' ? arr[0] : prev.x,
    y: typeof arr[1] === 'number' ? arr[1] : prev.y,
    z: typeof arr[2] === 'number' ? arr[2] : prev.z,
  }
}

export function createSensor(opts: SensorOptions): Sensor {
  const url = opts.url ?? 'ws://192.168.4.1:81/'
  const log = opts.log ?? (() => {})
  const reconnectMs = opts.reconnectMs ?? 2000

  const state = emptyState()

  let ws: WebSocket | null = null
  let closed = false
  let retryTimer: number | null = null

  function emit(): void {
    opts.onUpdate({ ...state })
  }

  function apply(d: Wire): void {
    if (typeof d.n === 'number') state.n = d.n
    state.acc = vec(d.acc, state.acc)
    state.gyro = vec(d.gyr, state.gyro)
    if (typeof d.tmp === 'number') state.imuTemp = d.tmp
    if (Array.isArray(d.bat)) {
      if (typeof d.bat[0] === 'number') state.batLevel = d.bat[0]
      if (typeof d.bat[1] === 'number') state.batMv = d.bat[1]
      if (typeof d.bat[2] === 'number') state.charging = d.bat[2] !== 0
    }
    state.touch = vec(d.tch, state.touch)
    if (typeof d.rtc === 'string') state.rtc = d.rtc
    if (typeof d.up === 'number') state.upMs = d.up
  }

  function connect(): void {
    if (closed) return
    log(`sensor: connecting ${url}`)
    try {
      ws = new WebSocket(url)
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      log(`sensor: connect threw ${state.error}`)
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      state.connected = true
      state.error = null
      log('sensor: connected')
      emit()
    }

    ws.onmessage = (ev) => {
      try {
        apply(JSON.parse(String(ev.data)) as Wire)
        emit()
      } catch {
        // パースできないフレームは無視
      }
    }

    ws.onerror = () => {
      state.error = 'ws error'
      log('sensor: ws error')
    }

    ws.onclose = () => {
      const wasConnected = state.connected
      state.connected = false
      if (wasConnected) log('sensor: disconnected')
      emit()
      scheduleReconnect()
    }
  }

  function scheduleReconnect(): void {
    if (closed) return
    if (retryTimer !== null) return
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      connect()
    }, reconnectMs)
  }

  connect()

  return {
    getState: () => ({ ...state }),
    close: () => {
      closed = true
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    },
  }
}
