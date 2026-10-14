/** Deployment availability policy covers prepared and direct background model calls. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import LlmRuntime, { LlmAdapter } from '../src/index.ts'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '../src/types.ts'

class AvailableAdapter extends LlmAdapter {
  models: readonly LlmModelInfo[] = [{ provider: 'gateway', id: 'company-model', name: 'Company model' }]
  calls = 0

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime, { requireAvailableModel: true })
  const adapter = new AvailableAdapter()
  const remove = ctx.llm.registerAdapter(['gateway'], adapter)
  return { ctx, adapter, remove }
}

const request: GenerateOptions = { provider: 'gateway', model: 'company-model', messages: [] }

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

it.each(['missing-provider', 'missing-model'])('rejects %s before adapter preparation', async (missing) => {
  const { ctx, adapter } = await fixture()
  const prepare = vi.spyOn(adapter, 'prepareCall')
  const config = missing === 'missing-provider'
    ? { provider: 'deepseek-account', model: 'old-model' }
    : { provider: 'gateway', model: 'removed-model' }
  await expect(ctx.llm.prepareCall(config)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
  expect(prepare).not.toHaveBeenCalled()
  expect(adapter.calls).toBe(0)
})

it('allows configured models in prepared calls and direct background streams', async () => {
  const { ctx, adapter } = await fixture()
  const prepared = await ctx.llm.prepareCall(request)
  expect(await collect(prepared.stream({ ...request, ...prepared.config })))
    .toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(await collect(ctx.llm.stream(request))).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(adapter.calls).toBe(2)
})

it.each(['provider', 'model'])('rechecks a removed %s before a prepared call dispatches', async (removed) => {
  const { ctx, adapter, remove } = await fixture()
  const prepared = await ctx.llm.prepareCall(request)
  if (removed === 'provider') remove()
  else adapter.models = []
  expect(await collect(prepared.stream({ ...request, ...prepared.config }))).toMatchObject([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'MODEL_UNAVAILABLE' } } },
  ])
  expect(adapter.calls).toBe(0)
})

it('blocks an unavailable model in direct streams before preparing the adapter', async () => {
  const { ctx, adapter } = await fixture()
  adapter.models = []
  const prepare = vi.spyOn(adapter, 'prepareCall')
  expect(await collect(ctx.llm.stream(request))).toMatchObject([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'MODEL_UNAVAILABLE' } } },
  ])
  expect(prepare).not.toHaveBeenCalled()
  expect(adapter.calls).toBe(0)
})

it('rechecks a direct stream after asynchronous adapter preparation', async () => {
  const { ctx, adapter } = await fixture()
  const prepare = adapter.prepareCall.bind(adapter)
  vi.spyOn(adapter, 'prepareCall').mockImplementation(async (...args) => {
    const prepared = await prepare(...args)
    adapter.models = []
    return prepared
  })
  expect(await collect(ctx.llm.stream(request))).toMatchObject([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'MODEL_UNAVAILABLE' } } },
  ])
  expect(adapter.calls).toBe(0)
})

it('fails closed when the catalog cannot be read', async () => {
  const { ctx, adapter } = await fixture()
  vi.spyOn(adapter, 'listModels').mockRejectedValue(new Error('catalog unavailable'))
  await expect(ctx.llm.prepareCall(request)).rejects.toThrow('catalog unavailable')
  expect(await collect(ctx.llm.stream(request))).toMatchObject([
    { type: 'finish', reason: { kind: 'error', failure: { message: 'catalog unavailable' } } },
  ])
  expect(adapter.calls).toBe(0)
})
