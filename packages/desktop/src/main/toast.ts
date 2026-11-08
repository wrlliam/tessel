// Pop-up messages on the computer's screen, above every other window, e.g. the song that just
// started. One small window, click-through and never focused, so it doesn't interrupt typing.
import type { ToastSpec } from '@tessel/core'
import { BrowserWindow, screen } from 'electron'

const WIDTH = 360
const MARGIN = 16

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/** The toast's HTML. Exported for tests. */
export function toastHtml(t: ToastSpec): string {
  const glyph =
    t.icon && [...t.icon].length <= 2 ? `<span class="glyph">${escape(t.icon)}</span>` : ''
  const accent = /^#[0-9a-f]{6}$/i.test(t.colour ?? '') ? t.colour : '#22D3C5'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { font: 14px/1.4 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 8px; }
  .card { display: flex; gap: 12px; align-items: flex-start; background: rgb(22 27 34 / 0.96);
    color: #F4F6F8; border-radius: 14px; padding: 14px 16px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.35),
    inset 0 0 0 1px rgb(244 246 248 / 0.08); animation: in 180ms cubic-bezier(0.22, 1, 0.36, 1); }
  .bar { width: 4px; align-self: stretch; border-radius: 2px; background: ${accent}; flex: none; }
  .glyph { font-size: 22px; line-height: 1.2; }
  .title { font-weight: 600; margin: 0 0 2px; }
  .body { margin: 0; color: #A9B4C2; white-space: pre-wrap; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  body.out .card { opacity: 0; transform: translateY(4px); transition: opacity 200ms, transform 200ms; }
  @keyframes in { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
</style></head><body><div class="card"><span class="bar"></span>${glyph}<div>
${t.title ? `<p class="title">${escape(t.title)}</p>` : ''}<p class="body">${escape(t.body)}</p>
</div></div></body></html>`
}

export class Toaster {
  private win?: BrowserWindow
  private hideTimer?: NodeJS.Timeout
  private fadeTimer?: NodeJS.Timeout

  async show(t: ToastSpec) {
    const win = this.window()
    clearTimeout(this.hideTimer)
    clearTimeout(this.fadeTimer)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toastHtml(t))}`)
    const height = Math.min(
      240,
      Number(await win.webContents.executeJavaScript('document.body.scrollHeight')) || 96,
    )
    const area = screen.getPrimaryDisplay().workArea
    const x = t.position.endsWith('left')
      ? area.x + MARGIN
      : t.position.endsWith('center')
        ? area.x + Math.round((area.width - WIDTH) / 2)
        : area.x + area.width - WIDTH - MARGIN
    const y = t.position.startsWith('top')
      ? area.y + MARGIN
      : area.y + area.height - height - MARGIN
    win.setBounds({ x, y, width: WIDTH, height })
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    const ms = Math.max(1, Math.min(60, t.seconds)) * 1000
    this.fadeTimer = setTimeout(
      () =>
        void win.webContents
          .executeJavaScript("document.body.classList.add('out')")
          .catch(() => {}),
      ms - 200,
    )
    this.hideTimer = setTimeout(() => win.hide(), ms)
  }

  dispose() {
    clearTimeout(this.hideTimer)
    clearTimeout(this.fadeTimer)
    this.win?.destroy()
  }

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: WIDTH,
      height: 96,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
      },
    })
    win.setIgnoreMouseEvents(true)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win = win
    return win
  }
}
