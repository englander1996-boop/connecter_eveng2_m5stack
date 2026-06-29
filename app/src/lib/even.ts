// Even G2 アプリ共通ヘルパ。
// - bridge connect (timeout 付き)
// - 全画面不可視 capture Text (isEventCapture: 1) の標準ページ構成
// - イベント正規化 (OsEventTypeList.fromJson) + デバウンス
// - mock mode (ブラウザ単独確認用)

import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'

const CAPTURE_NAME = 'evn-capture'
const CAPTURE_ID = 99

export type LensTextLine = {
  id: number
  name: string
  content: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export type EventKind = 'click' | 'double' | 'up' | 'down'
export type EventHandler = () => void | Promise<void>
export type Logger = (line: string) => void

export type EvenApp = {
  readonly bridge: EvenAppBridge | null
  readonly connected: boolean
  on(kind: EventKind, handler: EventHandler): void
  render(lines: LensTextLine[]): Promise<void>
  setLogger(logger: Logger): void
  audio?: AudioApi
}

export type AudioApi = {
  open(): Promise<boolean>
  close(): Promise<boolean>
  onPcm(handler: (pcm: Uint8Array) => void): () => void
}

export type ConnectOptions = {
  timeoutMs?: number
  debounceMs?: number
  // テキスト要素自体にもタップを拾わせたいときに captureContainer を false にできる
  captureContainer?: boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function pickRawEventType(event: EvenHubEvent): unknown {
  return (
    event.listEvent?.eventType ??
    event.textEvent?.eventType ??
    event.sysEvent?.eventType ??
    (event as { eventType?: unknown }).eventType ??
    (event.jsonData as { eventType?: unknown; event_type?: unknown } | undefined)?.eventType ??
    (event.jsonData as { event_type?: unknown } | undefined)?.event_type
  )
}

function pickSelectIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// イベント分類。
// even-dev/apps/hello は TextContainerProperty 単体 (isEventCapture: 1) で click/double/scroll を
// 拾えている (= List は必須ではない)。text-capture では eventType が typed (CLICK/SCROLL_TOP/...) で
// 来るのが基本。List-capture では eventType=undefined + currentSelectItemIndex の差分でしか
// scroll を判別できないケースがあるので、その fallback も残す。
function classifyKind(event: EvenHubEvent, prevIndex: number): EventKind | null {
  const raw = pickRawEventType(event)
  const type = OsEventTypeList.fromJson(raw)
  // typed event (eventType あり)
  if (type === OsEventTypeList.CLICK_EVENT) return 'click'
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'double'
  if (type === OsEventTypeList.SCROLL_TOP_EVENT) return 'up'
  if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'down'

  // 認識できない typed event (FOREGROUND_ENTER 等) はここで無視。
  // 以降は「eventType が一切無い (raw == null)」イベントだけのフォールバック。
  if (raw != null) return null

  // List-capture の fallback: idx 差分で scroll 判定、それ以外は click
  if (event.listEvent) {
    const idx = pickSelectIndex(event.listEvent.currentSelectItemIndex)
    if (idx !== null) {
      if (idx > prevIndex) return 'down'
      if (idx < prevIndex) return 'up'
    }
    return 'click'
  }
  // text-capture の単タップ: eventType 無しの sysEvent (eventSource のみ) または textEvent で届く。
  // ダブルタップは sysEvent.eventType=3 で来るので上の typed 分岐で先に拾われる。
  if (event.sysEvent || event.textEvent) return 'click'
  return null
}

export async function createEvenApp(options: ConnectOptions = {}): Promise<EvenApp> {
  const {
    timeoutMs = 4000,
    debounceMs = 250,
    captureContainer = true,
  } = options

  let bridge: EvenAppBridge | null = null
  let startupRendered = false
  let lastKind: EventKind | null = null
  let lastAt = 0
  let logger: Logger = () => {}
  // capture List の現在選択 index を追跡。scroll-up/down 判定に使う。
  // 初期値は List の初期 selection (0) と一致させる。
  let prevSelectIndex = 0

  const handlers: Record<EventKind, EventHandler[]> = {
    click: [],
    double: [],
    up: [],
    down: [],
  }

  try {
    bridge = await withTimeout(waitForEvenAppBridge(), timeoutMs)
  } catch {
    bridge = null
  }

  if (bridge) {
    let lastAudioLogAt = 0
    const AUDIO_LOG_INTERVAL_MS = 1000
    bridge.onEvenHubEvent((event) => {
      const kind = classifyKind(event, prevSelectIndex)
      // listEvent に index が乗っていれば「前回 index」を更新。次回 swipe の差分判定に使う。
      if (event.listEvent) {
        const idx = pickSelectIndex(event.listEvent.currentSelectItemIndex)
        if (idx !== null) prevSelectIndex = idx
      }
      const container =
        event.listEvent?.containerName ?? event.textEvent?.containerName ?? '-'
      const source = event.listEvent
        ? 'list'
        : event.textEvent
          ? 'text'
          : event.sysEvent
            ? 'sys'
            : event.audioEvent
              ? 'audio'
              : 'other'
      // audio (PCM) は秒数十回流れるので 1 秒スロットル。他のジェスチャ系は毎回ログ。
      if (source === 'audio') {
        const now = Date.now()
        if (now - lastAudioLogAt >= AUDIO_LOG_INTERVAL_MS) {
          logger(`event kind=${kind ?? 'unknown'} source=audio container=${container}`)
          lastAudioLogAt = now
        }
      } else {
        logger(`event kind=${kind ?? 'unknown'} source=${source} container=${container}`)
      }

      if (!kind) return
      const now = Date.now()
      if (lastKind === kind && now - lastAt < debounceMs) return
      lastKind = kind
      lastAt = now

      for (const h of handlers[kind]) {
        try {
          void h()
        } catch (err) {
          console.error(`[evenapp] handler for ${kind} threw`, err)
        }
      }
    })
  }

  async function render(lines: LensTextLine[]): Promise<void> {
    if (!bridge) return

    const textObject = lines.map(
      (l) =>
        new TextContainerProperty({
          containerID: l.id,
          containerName: l.name,
          content: l.content,
          xPosition: l.x ?? 8,
          yPosition: l.y ?? 8,
          width: l.width ?? 560,
          height: l.height ?? 40,
          isEventCapture: 0,
        }),
    )

    // イベント捕捉方式 (2026-05-25 方針転換):
    // even-dev/apps/hello は List を一切使わず TextContainerProperty 単体の isEventCapture: 1 で
    // click/double/scroll を全部拾えている (公式リファレンス)。List-capture 方式だと up が
    // 初期 idx=0 から発火せず詰むので、even-dev と同じ text-capture に切り替える。
    // 全画面 (576×136) の content=' ' な不可視 text に isEventCapture: 1 を付けて sink にする。
    if (captureContainer) {
      textObject.push(
        new TextContainerProperty({
          containerID: CAPTURE_ID,
          containerName: CAPTURE_NAME,
          content: ' ',
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 136,
          isEventCapture: 1,
        }),
      )
    }

    const payload = {
      containerTotalNum: textObject.length,
      textObject,
      listObject: [],
    }

    if (!startupRendered) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(payload))
      startupRendered = true
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(payload))
    }
  }

  function on(kind: EventKind, handler: EventHandler): void {
    handlers[kind].push(handler)
  }

  function setLogger(l: Logger): void {
    logger = l
  }

  const audio: AudioApi | undefined = bridge
    ? {
        async open() {
          return Boolean(await bridge!.audioControl(true))
        },
        async close() {
          return Boolean(await bridge!.audioControl(false))
        },
        onPcm(handler) {
          const unsubscribe = bridge!.onEvenHubEvent((event) => {
            if (event.audioEvent?.audioPcm) {
              handler(event.audioEvent.audioPcm)
            }
          })
          return unsubscribe
        },
      }
    : undefined

  return {
    get bridge() {
      return bridge
    },
    get connected() {
      return bridge !== null
    },
    on,
    render,
    setLogger,
    audio,
  }
}

// 簡便関数: テキスト 1〜数行を即生成
export function lines(...contents: string[]): LensTextLine[] {
  return contents.map((content, i) => ({
    id: i + 1,
    name: `line-${i + 1}`,
    content,
    x: 8,
    y: 8 + i * 56,
    width: 560,
    height: 52,
  }))
}
