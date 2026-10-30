/** Shipped intranet models use the public adapter with each deployment's wire dialect. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import Llm, { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { assemble } from '../../../llm/llm-pi-ai/tests/assemble.ts'
import { closeMockServers, mockServer, textEvents } from '../../../llm/llm-pi-ai/tests/mock-server.ts'

afterEach(async () => { vi.unstubAllEnvs(); await closeMockServers() })

async function composition(mode: 'standard' | 'intranet'): Promise<Context> {
  const patches = loadOverlayPatches('hezhi-defaults', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
  const configured = applyEntryPatches([
    { id: 'llm', name: 'cordis:llm' },
    { id: 'agent-default-model', name: 'cordis:default-model' },
    { id: 'llm-pi-ai', name: 'cordis:pi-ai' },
  ], patches.filter(patch => patch.id === 'agent-default-model' || patch.id === 'llm-pi-ai'), (message) => { throw Error(message) })
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('distributionMode', mode)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.llm = Llm
  ctx.loader.builtins['default-model'] = DefaultModel
  ctx.loader.builtins['pi-ai'] = PiAi
  await ctx.loader.root.update(configured)
  await ctx.loader.await()
  return ctx
}

it('offers the Hezhi default only in intranet mode and keeps it editable', async () => {
  vi.stubEnv('HEZHI_API_KEY','local-test-only')
  vi.stubEnv('DIZHI_API_KEY','local-test-only')
  const standard = await composition('standard')
  expect(standard.llm.listProviders()).toEqual([])
  expect(standard.agentDefaultModel.currentSelection()).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
  const intranet = await composition('intranet')
  expect(intranet.agentDefaultModel.currentSelection()).toEqual({ provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP' })
  expect(intranet.llm.listProviders()).toContainEqual(expect.objectContaining({ id: 'hezhi', name: '核智' }))
  expect(await intranet.llm.listModels('hezhi')).toContainEqual(expect.objectContaining({ id: 'Qwen3.6-27B' }))
  const entry = intranet.loader.resolve('llm-pi-ai')
  const raw = interpolate(entry.ctx, entry.options.config) as PiAi.Options
  expect(raw.providers?.hezhi?.baseURL).toBe('http://10.139.133.3:8001/v1')
  expect(raw.providers?.hezhi?.apiKeyEnv).toBe('HEZHI_API_KEY')
  expect(intranet.llm.listProviders()).toContainEqual(expect.objectContaining({ id: 'dizhi', name: '地质科技' }))
  expect(await intranet.llm.listModels('dizhi')).toContainEqual(expect.objectContaining({ id: 'gen-studio-Qwen3.6-27B-ygNP' }))
  expect(raw.providers?.dizhi?.baseURL).toBe('http://10.76.22.59/openai/v1')
  expect(raw.providers?.dizhi?.apiKeyEnv).toBe('DIZHI_API_KEY')
  await intranet.loader.resolve('agent-default-model').update({ config: { provider: 'custom', model: 'existing' } })
  await intranet.loader.await()
  expect(intranet.agentDefaultModel.currentSelection()).toEqual({ provider: 'custom', model: 'existing' })
})

it('sends Bearer authentication, system messages and template thinking flags through the real adapter', async () => {
  vi.stubEnv('HEZHI_API_KEY', 'local-test-only')
  const server = await mockServer([{ events: textEvents }, { events: textEvents }])
  const ctx = await composition('intranet')
  const entry = ctx.loader.resolve('llm-pi-ai')
  const raw = interpolate(entry.ctx, entry.options.config) as PiAi.Options
  await entry.update({ config: { providers: { hezhi: { ...raw.providers?.hezhi, baseURL: server.url + '/v1' } } } })
  await ctx.loader.await()
  for (const [effort, enabled] of [['off', false], ['high', true]] as const) {
    const result = await assemble(ctx, { provider: 'hezhi', model: 'Qwen3.6-27B',
      system: 'local test', reasoningEffort: ReasoningEffortId(effort), maxTokens: 32,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } })] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests.at(-1)).toMatchObject({ model: 'Qwen3.6-27B', stream: true,
      max_completion_tokens: 32, chat_template_kwargs: { enable_thinking: enabled },
      messages: [{ role: 'system' }, { role: 'user' }] })
    expect(server.requests.at(-1)).not.toHaveProperty('store')
    expect(server.requests.at(-1)).not.toHaveProperty('reasoning_effort')
  }
  expect(server.paths).toEqual(['/v1/chat/completions', '/v1/chat/completions'])
  expect(server.headers[0]?.authorization).toBe('Bearer local-test-only')
})

it('sends the Dizhi model and max_tokens to the prefixed Chat Completions endpoint', async () => {
  vi.stubEnv('DIZHI_API_KEY', 'local-test-only')
  const server = await mockServer([{ events: textEvents }])
  const ctx = await composition('intranet')
  const entry = ctx.loader.resolve('llm-pi-ai')
  const raw = interpolate(entry.ctx, entry.options.config) as PiAi.Options
  await entry.update({ config: { providers: { ...raw.providers,
    dizhi: { ...raw.providers?.dizhi, baseURL: server.url + '/openai/v1' },
  } } })
  await ctx.loader.await()
  const result = await assemble(ctx, { provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP',
    system: 'local test', maxTokens: 32,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } })],
  })
  expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  expect(server.requests[0]).toMatchObject({ model: 'gen-studio-Qwen3.6-27B-ygNP', stream: true, max_tokens: 32 })
  expect(server.requests[0]).not.toHaveProperty('max_completion_tokens')
  expect(server.requests[0]).not.toHaveProperty('reasoning_effort')
  expect(server.paths).toEqual(['/openai/v1/chat/completions'])
  expect(server.headers[0]?.authorization).toBe('Bearer local-test-only')
})

it('uses official adapter defaults for Dizhi without a deployment output cap', async () => {
  vi.stubEnv('DIZHI_API_KEY', 'local-test-only')
  const server = await mockServer([{ events: textEvents }])
  const ctx = await composition('intranet')
  const entry = ctx.loader.resolve('llm-pi-ai')
  const raw = interpolate(entry.ctx, entry.options.config) as PiAi.Options
  await entry.update({ config: { providers: { ...raw.providers,
    dizhi: { ...raw.providers?.dizhi, baseURL: server.url + '/openai/v1' },
  } } })
  await ctx.loader.await()
  const result = await assemble(ctx, { provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } })] })
  expect(result.finish).toEqual({ kind: 'stop' })
  expect(server.requests[0]).toMatchObject({ max_tokens: 32768 })
  const info = await ctx.llm.resolveModelInfo('dizhi', 'gen-studio-Qwen3.6-27B-ygNP')
  expect(info.context?.contextWindow).toBe(262144)
  expect(info.defaultMaxTokens).toBeUndefined()
})

it('retains a truncated Dizhi answer when continuing under official defaults', async () => {
  vi.stubEnv('DIZHI_API_KEY', 'local-test-only')
  const server = await mockServer([
    { events: [
      JSON.stringify({ choices: [{ delta: { role: 'assistant', reasoning_content: 'checking', content: 'partial answer' }, index: 0, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'length' }], usage: { prompt_tokens: 26882, completion_tokens: 266 } }),
      '[DONE]',
    ] },
    { events: textEvents },
  ])
  const ctx = await composition('intranet')
  const entry = ctx.loader.resolve('llm-pi-ai')
  const raw = interpolate(entry.ctx, entry.options.config) as PiAi.Options
  await entry.update({ config: { providers: { ...raw.providers,
    dizhi: { ...raw.providers?.dizhi, baseURL: server.url + '/openai/v1' },
  } } })
  await ctx.loader.await()
  const prompt = createUserMessage({ content: [{ type: 'text', text: 'Complete the report.' }], source: { kind: 'user' } })
  const first = await assemble(ctx, { provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP', messages: [prompt] })
  expect(first.finish).toEqual({ kind: 'max-tokens' })
  const next = await assemble(ctx, { provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP',
    messages: [prompt, first.message, createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } })] })
  expect(next.finish).toEqual({ kind: 'stop' })
  expect(server.requests[1]).toMatchObject({ max_tokens: 32768, messages: [
    { role: 'user', content: 'Complete the report.' },
    { role: 'assistant', content: 'partial answer' },
    { role: 'user', content: '继续' },
  ] })
})
