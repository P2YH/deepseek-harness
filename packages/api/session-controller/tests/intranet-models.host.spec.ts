/** Intranet entry points retain history without admitting missing model routes. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionAccess, SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { SessionRequestId } from '../src/types.ts'
import { createSessionTestRemote, testSessionPersistence } from './test-remote.ts'

class IntranetAdapter extends LlmAdapter {
  calls: GenerateOptions[] = []
  models: readonly LlmModelInfo[] = [{ provider: 'gateway', id: 'company-model', name: 'Company model' }]

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture() {
  const ctx = new Context()
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-intranet-models-'))
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(cwd, { recursive: true, force: true })
  })
  ctx.provide('distributionMode', 'intranet')
  ctx.provide('workspaceRegistry', { archivedSessionIds: [] } as never)
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  const adapter = new IntranetAdapter()
  const removeAdapter = ctx.llm.registerAdapter(['gateway'], adapter)
  let selected: ModelSelection | null = null
  const save = vi.fn((selection: ModelSelection) => { selected = selection })
  const remote = createSessionTestRemote(ctx, {
    cwd, defaultModelSelection: () => selected, saveDefaultModelSelection: save,
  })
  return { ctx, cwd, adapter, removeAdapter, remote, save }
}

function historicalEvents(): SessionEvent[] {
  return [
    { type: 'request/header', seq: SessionSeq(0), time: 1,
      data: { reason: 'initial', header: { config: { provider: 'deepseek-account', model: 'old-model' } } } },
    { type: 'user/message', seq: SessionSeq(1), time: 2, surfaceOp: 'append',
      data: createUserMessage({ content: [{ type: 'text', text: 'Historical prompt' }], source: { kind: 'user' } }) },
    { type: 'session-log-deepseek/delivery-accepted', seq: SessionSeq(2), time: 3,
      data: { sessionId: SessionId('old-official-session'), throughSeq: SessionSeq(1), sessionFormatVersion: SESSION_FORMAT_VERSION } },
  ]
}

function storeHistory(ctx: Context, cwd: string, events: SessionEvent[], beforeWrite?: () => void) {
  const id = SessionId('old-official-session')
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, cwd }
  const opens: SessionAccess[] = []
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([header]),
    inspect: () => Promise.resolve({ meta: header, inheritedEventCount: SessionLogOffset(0), events }),
    open: (_sessionId: SessionId, access: SessionAccess): Promise<SessionHandle> => {
      opens.push(access)
      if (access === 'write') beforeWrite?.()
      return Promise.resolve({
        id, header, inheritedEventCount: SessionLogOffset(0), access,
        read: () => Promise.resolve({ eventState: 'detached', events: structuredClone(events) }),
        append: (appended) => { events.push(...appended); return Promise.resolve() },
        flush: () => Promise.resolve(), close: () => Promise.resolve(), [Symbol.asyncDispose]: () => Promise.resolve(),
      })
    },
  }) as never)
  return { id, opens }
}

it('creates an empty workspace Session and rejects sending until an explicit model is selected', async () => {
  const { ctx, remote, adapter, save, removeAdapter } = await fixture()
  const created = await remote.create({})
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error('session was not created')
  const initial = [...session.snapshotEvents()]
  expect(await remote.modelCatalog()).toMatchObject({ ok: true, value: { default: null } })
  expect(await remote.prompt({ sessionId, requestId: 'unconfigured' as SessionRequestId,
    mode: 'queue', content: [{ type: 'text', text: 'Do work' }] }))
    .toMatchObject({ ok: false, error: { code: 'session/model-required' } })
  expect(session.snapshotEvents()).toEqual(initial)
  expect(adapter.calls).toEqual([])

  expect(await remote.selectModel({ sessionId, provider: 'gateway', model: 'company-model' }))
    .toMatchObject({ ok: true })
  expect(save).toHaveBeenCalledWith({ provider: 'gateway', model: 'company-model' })
  expect(await remote.modelCatalog()).toMatchObject({ ok: true,
    value: { default: { provider: 'gateway', model: 'company-model' } } })
  expect(await remote.prompt({ sessionId, requestId: 'configured' as SessionRequestId,
    mode: 'queue', content: [{ type: 'text', text: 'Do work' }] })).toMatchObject({ ok: true })
  await ctx.agents.get(sessionId)?.whenIdle()
  expect(adapter.calls).toHaveLength(1)

  const beforeRemoval = [...session.snapshotEvents()]
  removeAdapter()
  expect(await remote.prompt({ sessionId, requestId: 'removed' as SessionRequestId,
    mode: 'queue', content: [{ type: 'text', text: 'More work' }] }))
    .toMatchObject({ ok: false, error: { code: 'session/model-unavailable' } })
  expect(session.snapshotEvents()).toEqual(beforeRemoval)
  expect(adapter.calls).toHaveLength(1)
})

it('rejects account model initialization before inspecting provider configuration or credentials', async () => {
  const { ctx, remote, save } = await fixture()
  const settings = vi.fn(() => { throw new Error('settings must not be inspected') })
  const credentials = vi.fn(() => { throw new Error('credentials must not be inspected') })
  ctx.provide('settings', { describe: settings } as never)
  ctx.provide('credentials', { describe: credentials } as never)
  expect(await remote.initializeDefaultModel())
    .toMatchObject({ ok: false, error: { code: 'session/provider-models-unavailable' } })
  expect(settings).not.toHaveBeenCalled()
  expect(credentials).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

it('creates a new Session when the named Session has already started a turn', async () => {
  const { ctx, cwd, remote, adapter } = await fixture()
  const created = await remote.create({ cwd })
  if (!created.ok) throw created.error
  const session = ctx.sessions.get(created.value.sessionId)
  if (session === undefined) throw new Error('session was not created')
  session.append('turn/start', { turn: 1 })
  const original = [...session.snapshotEvents()]
  const next = await remote.create({ sessionId: session.id, cwd })
  if (!next.ok) throw next.error
  expect(next.value.sessionId).not.toBe(session.id)
  expect(session.snapshotEvents()).toEqual(original)
  expect(adapter.calls).toEqual([])
})

it('reuses a persisted blank Session without a default and still rejects its first prompt', async () => {
  const { ctx, cwd, remote, adapter } = await fixture()
  const events: SessionEvent[] = [{ type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: {} }]
  const original = structuredClone(events)
  const { id, opens } = storeHistory(ctx, cwd, events)
  const result = await remote.create({ sessionId: id, cwd })
  expect(result).toMatchObject({ ok: true, value: { sessionId: id } })
  expect(opens).toContain('write')
  expect(ctx.agents.get(id)).toBeDefined()
  expect(await remote.prompt({ sessionId: id, requestId: 'reused-blank' as SessionRequestId,
    mode: 'queue', content: [{ type: 'text', text: 'Do work' }] }))
    .toMatchObject({ ok: false, error: { code: 'session/model-required' } })
  expect(events).toEqual(original)
  expect(adapter.calls).toEqual([])
})

it.each(['next-turn', 'next-step'] as const)('requires a model before adopting cold %s work', async (kind) => {
  const { ctx, cwd, remote, adapter } = await fixture()
  const events: SessionEvent[] = [{ type: 'agent/inbox/spliced', seq: SessionSeq(0), time: 1,
    data: { target: kind, start: 0, inserted: [createUserMessage({
      content: [{ type: 'text', text: 'Pending work' }], source: { kind: 'user' },
    })] } }]
  const original = structuredClone(events)
  const { id, opens } = storeHistory(ctx, cwd, events)
  expect(await remote.create({ sessionId: id, cwd }))
    .toMatchObject({ ok: false, error: { code: 'session/model-required' } })
  expect(opens).not.toContain('write')
  expect(events).toEqual(original)
  expect(adapter.calls).toEqual([])
})

it('rechecks work appended between blank inspection and writer acquisition', async () => {
  const { ctx, cwd, remote, adapter } = await fixture()
  const blank: SessionEvent = { type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: {} }
  const events: SessionEvent[] = [blank]
  const pending: SessionEvent = { type: 'agent/inbox/spliced', seq: SessionSeq(1), time: 2,
    data: { target: 'next-turn', start: 0, inserted: [createUserMessage({
      content: [{ type: 'text', text: 'Racing work' }], source: { kind: 'user' },
    })] } }
  const { id } = storeHistory(ctx, cwd, events, () => { events.push(pending) })
  expect(await remote.create({ sessionId: id, cwd }))
    .toMatchObject({ ok: false, error: { code: 'session/model-required' } })
  expect(ctx.agents.get(id)).toBeUndefined()
  // AgentLoop appends its resume marker before unpublished setup can reject the new work.
  expect(events).toEqual([blank, pending, expect.objectContaining({ type: 'session/end-seed' })])
  expect(adapter.calls).toEqual([])
})

it.each(['unconfigured', 'old-official'] as const)('reads %s history without promoting or rewriting its Session', async (kind) => {
  const { ctx, cwd, remote, adapter } = await fixture()
  const events = kind === 'old-official' ? historicalEvents() : []
  const original = structuredClone(events)
  const { id, opens } = storeHistory(ctx, cwd, events)
  const abort = new AbortController()
  const iterator = remote.follow({ address: { kind: 'session', sessionId: id } }, abort.signal)[Symbol.asyncIterator]()
  const opening = await iterator.next()
  expect(opening).toMatchObject({ value: { type: 'snapshot', cursor: events.length - 1 } })
  const waiting = iterator.next()
  expect(await remote.page({ address: { kind: 'session', sessionId: id }, throughSeq: events.length - 1 }))
    .toMatchObject({ ok: true })
  expect(await remote.prompt({ sessionId: id, requestId: 'old-route' as SessionRequestId,
    mode: 'queue', content: [{ type: 'text', text: 'Continue' }] }))
    .toMatchObject({ ok: false, error: { code: kind === 'unconfigured' ? 'session/model-required' : 'session/model-unavailable' } })
  abort.abort()
  await waiting
  await ctx.fiber.dispose()
  expect(opens).not.toContain('write')
  expect(events).toEqual(original)
  expect(adapter.calls).toEqual([])
})

it('retains old official history and saves an explicitly selected replacement before resumed work', async () => {
  const { ctx, cwd, remote, adapter, save } = await fixture()
  const events = historicalEvents()
  const original = structuredClone(events)
  const { id } = storeHistory(ctx, cwd, events)
  expect(await remote.selectModel({ sessionId: id, provider: 'gateway', model: 'company-model' }))
    .toMatchObject({ ok: true, value: { selected: { provider: 'gateway', model: 'company-model' } } })
  expect(events.slice(0, original.length)).toEqual(original)
  expect(events.filter(event => event.type === 'model/selection')).toHaveLength(1)
  expect(save).toHaveBeenCalledWith({ provider: 'gateway', model: 'company-model' })
  expect(await remote.prompt({ sessionId: id, requestId: 'continue-old' as SessionRequestId,
    mode: 'queue', content: [{ type: 'text', text: 'Continue' }] })).toMatchObject({ ok: true })
  await ctx.agents.get(id)?.whenIdle()
  expect(adapter.calls).toHaveLength(1)
  expect(adapter.calls[0]).toMatchObject({ provider: 'gateway', model: 'company-model' })
  expect(events.slice(0, original.length)).toEqual(original)
})
