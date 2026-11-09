/** Desktop external launches retain separate lifetimes and correlate private IPC replies. */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopExternalAction, dispatchDesktopExternalAction, launchDetachedApplication } from '../src/index.ts'
import { openNativeAssociatedPath, openNativePath, openNativeTextFile, revealNativePath } from '../src/path-opener.ts'
import { openNativeFileApplication } from '../src/file-applications.ts'

function bridge() {
  const channel = new EventEmitter()
  const send = vi.fn((_message: object, callback: (error: Error | null) => void) => { callback(null) })
  vi.stubEnv('DSH_DESKTOP_EXTERNAL_APPLICATION_PARENT_PID', String(process.ppid))
  vi.stubGlobal('process', { ...process, send,
    on: channel.on.bind(channel), once: channel.once.bind(channel), removeListener: channel.removeListener.bind(channel) })
  return { channel, send, reply(index: number, error?: string, code?: string) {
    const request = send.mock.calls[index]![0] as { requestId: string }
    channel.emit('message', { type: 'desktop-external-result', requestId: request.requestId,
      ...(error === undefined ? {} : { error }), ...(code === undefined ? {} : { code }) })
  } }
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('Desktop external applications', () => {
  it('does not route an inherited marker through a descendant IPC channel', () => {
    const f = bridge()
    vi.stubEnv('DSH_DESKTOP_EXTERNAL_APPLICATION_PARENT_PID', String(process.ppid + 1))
    expect(desktopExternalAction({ kind: 'path', path: '/fixture', intent: 'default' })).toBeUndefined()
    expect(f.send).not.toHaveBeenCalled()
  })
  it('correlates concurrent launches without spawning an application inside the Host', async () => {
    vi.useFakeTimers()
    const f = bridge()
    const first = launchDetachedApplication('unresolvable-editor-fixture', ['one'], { watchMs: 100, env: {} })
    const second = launchDetachedApplication('unresolvable-editor-fixture', ['two'], { watchMs: 100, env: {} })
    const rejected = expect(second).rejects.toThrow('editor unavailable')
    f.reply(1, 'editor unavailable')
    f.reply(0)
    await first
    await rejected
    expect(f.channel.listenerCount('message')).toBe(0)
    expect(f.channel.listenerCount('disconnect')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['timeout', 'cancel', 'disconnect'] as const)('ends waiting and releases listeners on %s', async (outcome) => {
    vi.useFakeTimers()
    const f = bridge()
    const abort = new AbortController()
    const waiting = desktopExternalAction({ kind: 'path', path: '/fixture', intent: 'default' }, abort.signal)
    const rejected = expect(waiting).rejects.toThrow(outcome === 'timeout' ? 'timed out' : outcome === 'cancel' ? 'cancelled' : 'channel closed')
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(12_000)
    else if (outcome === 'cancel') abort.abort()
    else f.channel.emit('disconnect')
    await rejected
    expect(f.channel.listenerCount('message')).toBe(0)
    expect(f.channel.listenerCount('disconnect')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves ENOENT so an uninstalled external editor can be resolved again', async () => {
    const f = bridge()
    const opened = launchDetachedApplication('removed-editor', [], { watchMs: 10, env: {} })
    const rejected = expect(opened).rejects.toMatchObject({ code: 'ENOENT' })
    f.reply(0, 'editor no longer exists', 'ENOENT')
    await rejected
  })

  it('reports a missing executable from the shell with its original error code', async () => {
    const result = Promise.withResolvers<object>()
    expect(dispatchDesktopExternalAction({ type: 'desktop-external-action', requestId: 'missing-editor', action: {
      kind: 'launch', command: 'dsh-nonexistent-external-editor-fixture', args: [], options: { env: {}, watchMs: 100 },
    } }, result.resolve)).toBe(true)
    expect(await result.promise).toMatchObject({ type: 'desktop-external-result', requestId: 'missing-editor', code: 'ENOENT' })
  })

  it.each([
    [openNativePath, 'default'], [openNativeAssociatedPath, 'association'],
    [openNativeTextFile, 'text-editor'], [revealNativePath, 'reveal'],
  ] as const)('delegates a path opener with intent %s', async (open, intent) => {
    const f = bridge()
    const opened = open('/fixture', new AbortController().signal)
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'path', path: '/fixture', intent } }), expect.any(Function))
    f.reply(0)
    await opened
  })

  it('delegates file handlers so the shell revalidates the chosen association', async () => {
    const f = bridge()
    const opened = openNativeFileApplication('/fixture', 'registered-editor', new AbortController().signal)
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'file', path: '/fixture', application: 'registered-editor' } }), expect.any(Function))
    f.reply(0)
    await opened
  })

  it.each([
    { kind: 'path', path: '/fixture', intent: 'arbitrary-command' },
    { kind: 'file', path: '/fixture', application: 7 },
    { kind: 'launch', command: 'editor', args: [false], options: { env: {}, watchMs: 1 } },
    { kind: 'launch', command: 'editor', args: [], options: { env: { KEY: 1 }, watchMs: 1 } },
    { kind: 'launch', command: 'editor', args: [], options: { env: {}, watchMs: -1 } },
    { kind: 'launch', command: 'editor', args: [], options: { env: {}, watchMs: 1, windowsHide: 'yes' } },
  ])('rejects malformed external IPC before launching: %j', (action) => {
    const reply = vi.fn()
    expect(() => dispatchDesktopExternalAction({ type: 'desktop-external-action', requestId: 'invalid', action }, reply)).toThrow('Invalid Desktop external action')
    expect(reply).not.toHaveBeenCalled()
  })
})
