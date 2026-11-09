/** Validate private Desktop IPC before launching external applications in the shell process. */
import { launchDetachedApplication, type DesktopExternalAction } from './external-application.ts'
import { openNativeAssociatedPath, openNativePath, openNativeTextFile, revealNativePath } from './path-opener.ts'
import { openNativeFileApplication } from './file-applications.ts'

function parseAction(value: unknown): DesktopExternalAction {
  if (typeof value !== 'object' || value === null || !('kind' in value)) throw new Error('Invalid Desktop external action')
  if (value.kind === 'path' && 'path' in value && typeof value.path === 'string' && 'intent' in value
    && (value.intent === 'default' || value.intent === 'association' || value.intent === 'text-editor' || value.intent === 'reveal')) {
    return { kind: 'path', path: value.path, intent: value.intent }
  }
  if (value.kind === 'file' && 'path' in value && typeof value.path === 'string' && 'application' in value && typeof value.application === 'string') {
    return { kind: 'file', path: value.path, application: value.application }
  }
  if (value.kind === 'launch' && 'command' in value && typeof value.command === 'string' && 'args' in value && Array.isArray(value.args)
    && value.args.every((arg: unknown) => typeof arg === 'string') && 'options' in value && typeof value.options === 'object' && value.options !== null) {
    const options = value.options
    if ('env' in options && typeof options.env === 'object' && options.env !== null && !Array.isArray(options.env)
      && Object.values(options.env).every(entry => typeof entry === 'string') && 'watchMs' in options
      && typeof options.watchMs === 'number' && Number.isSafeInteger(options.watchMs) && options.watchMs >= 0 && options.watchMs <= 2_147_481_647
      && (!('windowsHide' in options) || options.windowsHide === undefined || typeof options.windowsHide === 'boolean')) {
      return { kind: 'launch', command: value.command, args: value.args, options: {
        env: options.env as Record<string, string>, watchMs: options.watchMs,
        ...('windowsHide' in options ? { windowsHide: options.windowsHide as boolean | undefined } : {}),
      } }
    }
  }
  throw new Error('Invalid Desktop external action')
}

/**
 * Handle one Host request outside its Job, leaving unrelated IPC to the Host controller.
 * @param message - Untrusted private child-process message.
 * @param reply - Send the correlated outcome while the Host remains connected.
 * @returns Whether this message belongs to the external-application protocol; malformed requests throw.
 */
export function dispatchDesktopExternalAction(message: unknown, reply: (message: object) => void): boolean {
  if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'desktop-external-action') return false
  if (!('requestId' in message) || typeof message.requestId !== 'string' || !('action' in message)) throw new Error('Invalid Desktop external request')
  const action = parseAction(message.action)
  const run = async (): Promise<void> => {
    if (action.kind === 'launch') return launchDetachedApplication(action.command, action.args, action.options)
    const signal = AbortSignal.timeout(10_000)
    if (action.kind === 'file') return openNativeFileApplication(action.path, action.application, signal)
    switch (action.intent) {
      case 'default': return openNativePath(action.path, signal)
      case 'association': return openNativeAssociatedPath(action.path, signal)
      case 'text-editor': return openNativeTextFile(action.path, signal)
      case 'reveal': return revealNativePath(action.path, signal)
    }
  }
  void run().then(() => { reply({ type: 'desktop-external-result', requestId: message.requestId }) },
    (error: unknown) => { reply({ type: 'desktop-external-result', requestId: message.requestId, error: String(error),
      ...(error instanceof Error && 'code' in error && (typeof error.code === 'string' || typeof error.code === 'number') ? { code: error.code } : {}) }) })
  return true
}
