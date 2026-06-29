import { defineConfig } from 'vite'

// 完全自己完結。helper は src/lib に同梱しているので server.fs.allow は不要。
// dev サーバはスマホ実機(EvenHubアプリ webview)から見えるよう 0.0.0.0 で公開。
export default defineConfig({
  server: { host: '0.0.0.0', port: 5241 },
})
