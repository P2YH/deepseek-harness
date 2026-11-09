/** Document unload approval while the Desktop Host and tray are still available. */

import type { BrowserWindow } from 'electron'

/**
 * Close the workspace before stopping its backend. A document that vetoes unloading requires explicit discard approval.
 * @param window - Workspace window whose ordinary close-to-background handler permits this quit attempt.
 * @param confirmDiscard - Ask whether to discard unsaved changes; cancellation leaves the document open.
 * @returns Whether the window closed; rejects if closing or the confirmation fails, without forcing document destruction.
 */
export function closeDesktopWindowForQuit(window: BrowserWindow, confirmDiscard: () => Promise<boolean>): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(true)
  const contents = window.webContents
  return new Promise((resolve, reject) => {
    let settled = false
    let deciding = false
    const cleanup = (): void => {
      window.removeListener('closed', closed)
      contents.removeListener('will-prevent-unload', prevented)
    }
    const finish = (approved: boolean): void => {
      settled = true
      cleanup()
      resolve(approved)
    }
    const failed = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error('Desktop workspace close failed', { cause: error }))
    }
    const closed = (): void => { finish(true) }
    const prevented = (): void => {
      if (deciding) return
      deciding = true
      void Promise.resolve().then(confirmDiscard).then((approved) => {
        if (settled) return
        if (approved) window.destroy()
        else finish(false)
      }).catch(failed)
    }
    window.once('closed', closed)
    contents.on('will-prevent-unload', prevented)
    try { window.close() } catch (error) { failed(error) }
  })
}
