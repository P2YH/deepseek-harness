import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from '../../../packages/llm/llm-pi-ai/tests/assemble.ts'
import { closeMockServers, mockServer, textEvents } from '../../../packages/llm/llm-pi-ai/tests/mock-server.ts'
import { seedIntranetModelCredentials } from '../src/intranet-model-credentials.ts'

const roots: string[] = []
afterEach(async () => {
  await closeMockServers()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it('repairs both missing-credential routes through the real credential service and adapter, keeping saved keys first', async () => {
  const { root, profile, seed } = await setup()
  const server = await mockServer([{ events: textEvents }, { events: textEvents }, { events: textEvents }])
  const boot = async (dotenv: string) => {
    const ctx = new Context()
    const values = Object.fromEntries(Object.entries(parseEnv(dotenv))
      .filter((entry): entry is [string, string] => entry[1] !== undefined))
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'user-env', path: join(profile, '.env'), values }]))
    await ctx.plugin(CredentialsLocal, { dshHome: root, watch: false })
    await ctx.plugin(Llm)
    await ctx.plugin(PiAi, { providers: {
      dizhi: { api: 'openai-completions', baseURL: server.url + '/v1', apiKeyEnv: 'DIZHI_API_KEY',
        models: [{ id: 'gen-studio-Qwen3.6-27B-ygNP', contextWindow: 32768, maxTokens: 8192 }] },
      hezhi: { api: 'openai-completions', baseURL: server.url + '/v1', apiKeyEnv: 'HEZHI_API_KEY',
        models: [{ id: 'Qwen3.6-27B', contextWindow: 32768, maxTokens: 8192 }] },
    } })
    return ctx
  }
  const missing = await boot('')
  try {
    for (const [provider, model] of [['dizhi', 'gen-studio-Qwen3.6-27B-ygNP'], ['hezhi', 'Qwen3.6-27B']] as const) {
      expect((await assemble(missing, { provider, model, messages: [] })).finish)
        .toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    }
    expect(server.requests).toHaveLength(0)
  } finally { await missing.fiber.dispose() }
  await seedIntranetModelCredentials(profile, seed)
  const ready = await boot(await readFile(join(profile, '.env'), 'utf8'))
  try {
    for (const [provider, model, expected] of [['dizhi', 'gen-studio-Qwen3.6-27B-ygNP', 'test-dizhi'], ['hezhi', 'Qwen3.6-27B', 'test-hezhi']] as const) {
      expect((await assemble(ready, { provider, model, messages: [] })).message.content).toEqual([{ type: 'text', text: 'hello' }])
      expect(server.headers.at(-1)?.authorization).toBe(`Bearer ${expected}`)
    }
    await ready.credentials.set(credentialRef('DIZHI_API_KEY'), 'saved-target-key')
  } finally { await ready.fiber.dispose() }
  await seedIntranetModelCredentials(profile, seed)
  const restarted = await boot(await readFile(join(profile, '.env'), 'utf8'))
  try {
    await assemble(restarted, { provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP', messages: [] })
    expect(server.headers.at(-1)?.authorization).toBe('Bearer saved-target-key')
  } finally { await restarted.fiber.dispose() }
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-intranet-keys-'))
  roots.push(root)
  const seed = join(root, 'seed.json')
  await writeFile(seed, JSON.stringify({ version: 1, refs: { DIZHI_API_KEY: 'test-dizhi', HEZHI_API_KEY: 'test-hezhi' } }))
  return { root, seed, profile: join(root, 'profile') }
}

it('makes both deployment credentials available through the profile dotenv on a fresh installation', async () => {
  const { profile, seed } = await setup()
  await seedIntranetModelCredentials(profile, seed)
  expect(parseEnv(await readFile(join(profile, '.env'), 'utf8'))).toEqual({
    DIZHI_API_KEY: 'test-dizhi', HEZHI_API_KEY: 'test-hezhi',
  })
})

it('preserves existing values and comments, fills missing or blank keys, and is idempotent', async () => {
  const { profile, seed } = await setup()
  await seedIntranetModelCredentials(profile, seed)
  const existing = '# target configuration\r\nDIZHI_API_KEY=target-key\r\nHEZHI_API_KEY=\r\nOTHER=keep'
  await writeFile(join(profile, '.env'), existing)
  await seedIntranetModelCredentials(profile, seed)
  const first = await readFile(join(profile, '.env'), 'utf8')
  expect(first.startsWith(existing)).toBe(true)
  expect(parseEnv(first)).toEqual({ DIZHI_API_KEY: 'target-key', HEZHI_API_KEY: 'test-hezhi', OTHER: 'keep' })
  await seedIntranetModelCredentials(profile, seed)
  expect(await readFile(join(profile, '.env'), 'utf8')).toBe(first)
})

it('serializes concurrent first launches without losing or duplicating keys', async () => {
  const { profile, seed } = await setup()
  await Promise.all([seedIntranetModelCredentials(profile, seed), seedIntranetModelCredentials(profile, seed)])
  const raw = await readFile(join(profile, '.env'), 'utf8')
  expect(raw.match(/DIZHI_API_KEY=/gu)).toHaveLength(1)
  expect(raw.match(/HEZHI_API_KEY=/gu)).toHaveLength(1)
})

it('refuses malformed or incomplete seed files without including secret text in errors', async () => {
  const { profile, seed } = await setup()
  for (const raw of ['{"test-secret":', JSON.stringify({ version: 1, refs: { DIZHI_API_KEY: 'test-secret' } }),
    JSON.stringify({ version: 1, refs: { DIZHI_API_KEY: 'test-secret\nunsafe', HEZHI_API_KEY: 'test' } })]) {
    await writeFile(seed, raw)
    await expect(seedIntranetModelCredentials(profile, seed)).rejects.toThrow(/^desktop intranet credentials: invalid deployment file$/u)
  }
})
