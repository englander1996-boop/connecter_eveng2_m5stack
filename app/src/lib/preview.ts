// ブラウザ側のミニ UI 骨格。タイトル / 状態 / ボタン群 / イベントログ。
// 接続前後の状態表示と「Next / Reset」みたいなテストボタンを並べる用途。

export type PreviewButton = {
  id: string
  label: string
  variant?: 'primary' | 'secondary'
  onClick: () => void | Promise<void>
}

export type Preview = {
  setStatus(text: string): void
  setContent(text: string): void
  log(line: string): void
  appendBody(html: string): void
  setButtonLabel(id: string, label: string): void
  setButtonEnabled(id: string, enabled: boolean): void
}

export type PreviewOptions = {
  title: string
  subtitle?: string
  buttons?: PreviewButton[]
}

export function setupPreview(opts: PreviewOptions): Preview {
  const root = document.getElementById('app')
  if (!root) throw new Error('Missing #app')

  ensureStyles()

  root.innerHTML = `
    <header class="even-header">
      <h1 class="even-title">${escapeHtml(opts.title)}</h1>
      ${opts.subtitle ? `<p class="even-subtitle">${escapeHtml(opts.subtitle)}</p>` : ''}
      <p class="even-status" id="even-status">Not connected</p>
    </header>
    <section class="even-card">
      <div class="even-row" id="even-buttons"></div>
    </section>
    <section class="even-card">
      <p class="even-label">Current content</p>
      <pre class="even-content" id="even-content">-</pre>
    </section>
    <section class="even-card" id="even-extra-card" style="display: none;">
      <p class="even-label">Extra</p>
      <div id="even-extra"></div>
    </section>
    <section class="even-card">
      <p class="even-label">Event log</p>
      <pre class="even-log" id="even-log"></pre>
    </section>
  `

  const statusEl = document.getElementById('even-status') as HTMLParagraphElement
  const contentEl = document.getElementById('even-content') as HTMLPreElement
  const logEl = document.getElementById('even-log') as HTMLPreElement
  const buttonsEl = document.getElementById('even-buttons') as HTMLDivElement
  const extraCard = document.getElementById('even-extra-card') as HTMLDivElement
  const extraEl = document.getElementById('even-extra') as HTMLDivElement

  const buttonById = new Map<string, HTMLButtonElement>()

  for (const b of opts.buttons ?? []) {
    const btn = document.createElement('button')
    btn.id = `even-btn-${b.id}`
    btn.textContent = b.label
    btn.className = b.variant === 'secondary' ? 'even-btn even-btn-secondary' : 'even-btn'
    btn.addEventListener('click', () => {
      void b.onClick()
    })
    buttonsEl.appendChild(btn)
    buttonById.set(b.id, btn)
  }

  function setStatus(text: string): void {
    statusEl.textContent = text
  }

  function setContent(text: string): void {
    contentEl.textContent = text
  }

  function log(line: string): void {
    const stamp = new Date().toLocaleTimeString()
    logEl.textContent = `[${stamp}] ${line}\n` + logEl.textContent
  }

  function appendBody(html: string): void {
    extraCard.style.display = ''
    extraEl.innerHTML = html
  }

  function setButtonLabel(id: string, label: string): void {
    const btn = buttonById.get(id)
    if (btn) btn.textContent = label
  }

  function setButtonEnabled(id: string, enabled: boolean): void {
    const btn = buttonById.get(id)
    if (btn) btn.disabled = !enabled
  }

  return { setStatus, setContent, log, appendBody, setButtonLabel, setButtonEnabled }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ensureStyles(): void {
  if (document.getElementById('even-preview-style')) return
  const style = document.createElement('style')
  style.id = 'even-preview-style'
  style.textContent = `
    :root { color-scheme: dark; }
    body {
      margin: 0; padding: 24px;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #0d0d0d; color: #f0f0f0; min-height: 100vh;
    }
    #app {
      max-width: 640px; margin: 0 auto;
      display: flex; flex-direction: column; gap: 16px;
    }
    .even-header { display: flex; flex-direction: column; gap: 4px; }
    .even-title { margin: 0; font-size: 24px; }
    .even-subtitle { margin: 0; color: #888; font-size: 13px; }
    .even-status { margin: 4px 0 0; color: #b0b0b0; font-size: 13px; }
    .even-card {
      background: #161616; border: 1px solid #2a2a2a;
      border-radius: 12px; padding: 16px;
    }
    .even-label { font-size: 12px; color: #888; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .even-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .even-btn {
      appearance: none; border: none;
      background: #3268d6; color: white;
      font-size: 14px; font-weight: 600;
      padding: 10px 16px; border-radius: 8px; cursor: pointer;
    }
    .even-btn:hover { background: #4178e6; }
    .even-btn:disabled { background: #1a3060; color: #666; cursor: not-allowed; }
    .even-btn-secondary { background: #2a2a2a; }
    .even-btn-secondary:hover { background: #3a3a3a; }
    .even-content {
      background: #0a0a0a; border: 1px solid #222; border-radius: 8px;
      padding: 12px; margin: 0; font-size: 16px; min-height: 24px;
      white-space: pre-wrap; word-break: break-word;
    }
    .even-log {
      background: #0a0a0a; border: 1px solid #222; border-radius: 8px;
      padding: 10px; margin: 0; font-size: 11px;
      max-height: 200px; overflow: auto;
    }
  `
  document.head.appendChild(style)
}
