/** Detached GUI launches; Desktop delegates them outside its Host process Job. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/** External actions whose processes must outlive the Desktop Host. */
export type DesktopExternalAction =
  | { readonly kind: 'launch'; readonly command: string; readonly args: readonly string[]; readonly options: DetachedApplicationOptions }
  | { readonly kind: 'path'; readonly path: string; readonly intent: 'default' | 'association' | 'text-editor' | 'reveal' }
  | { readonly kind: 'file'; readonly path: string; readonly application: string }

/** A detached launch's complete environment and early-failure observation budget. */
export interface DetachedApplicationOptions {
  readonly env: Readonly<Record<string, string>>
  readonly watchMs: number
  readonly windowsHide?: boolean | undefined
}

/**
 * Delegate an external action when running in a Desktop-owned Host.
 * @param action - Verified path or argv and scrubbed environment from the owning caller.
 * @param signal - Optional caller cancellation; a dispatched application may already be running.
 * @returns Shell acknowledgement, or undefined outside Desktop; a missing shell reply rejects.
 */
export function desktopExternalAction(action: DesktopExternalAction, signal?: AbortSignal): Promise<void> | undefined {
  // Descendants inherit environment values, but only the direct Host owns the shell's IPC channel.
  if (process.env.DSH_DESKTOP_EXTERNAL_APPLICATION_PARENT_PID !== String(process.ppid) || process.send === undefined) return undefined
  signal?.throwIfAborted()
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.removeListener('message', answered)
      process.removeListener('disconnect', disconnected)
      signal?.removeEventListener('abort', aborted)
      if (error === undefined) resolve()
      else reject(error)
    }
    const answered = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'desktop-external-result'
        || !('requestId' in message) || message.requestId !== requestId) return
      if ('error' in message) {
        const error = new Error(String(message.error))
        if ('code' in message && (typeof message.code === 'string' || typeof message.code === 'number')) Object.assign(error, { code: message.code })
        finish(error)
      } else finish()
    }
    const disconnected = (): void => { finish(new Error('Desktop external application channel closed')) }
    const aborted = (): void => {
      finish(Object.assign(new Error('Desktop external application request cancelled', { cause: signal?.reason }), { code: 'ABORT_ERR' }))
    }
    const timer = setTimeout(() => { finish(new Error('Desktop external application launch timed out')) },
      (action.kind === 'launch' ? action.options.watchMs : 10_000) + 2_000)
    process.on('message', answered)
    process.once('disconnect', disconnected)
    signal?.addEventListener('abort', aborted, { once: true })
    process.send?.({ type: 'desktop-external-action', requestId, action }, (error) => { if (error !== null) finish(error) })
  })
}

/**
 * Start a GUI process detached, observing only early failure without ending its lifetime.
 * @param command - Executable path or PATH name; never a shell command.
 * @param args - Executable arguments.
 * @param options - Complete environment, visibility, and early-failure budget.
 * @returns After a successful early exit or the observation budget; rejects on early failure.
 */
export function launchDetachedApplication(command: string, args: readonly string[], options: DetachedApplicationOptions): Promise<void> {
  const delegated = desktopExternalAction({ kind: 'launch', command, args, options })
  if (delegated !== undefined) return delegated
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: options.windowsHide, env: options.env })
    let settled = false
    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(watch)
      child.unref()
      if (error === undefined) resolve()
      else reject(error)
    }
    const watch = setTimeout(() => { settle() }, options.watchMs)
    child.on('error', settle)
    child.on('exit', (code, signal) => { settle(code === 0 ? undefined : new Error(`launcher exited with code ${String(code)}, signal ${String(signal)}`)) })
  })
}
