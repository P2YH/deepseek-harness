/** Intranet composition preserves stored layers and enforces model availability through the real Loader. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import * as llmModule from '@deepseek-ai/dsh-llm'
import * as defaultModelModule from '@deepseek-ai/dsh-agent-default-model'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { applyDistributionEntries, boot, composeEntries, readProfilePatches, resolveProfileDistributionMode } from '../src/index.ts'
import type { Profile } from '../src/profile.ts'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-intranet-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

const official: EntryOptions = {
  id: 'renamed-account', name: '@deepseek-ai/dsh-deepseek-account-platform', disabled: false,
}

it('selects intranet only for Desktop, Web and custom Web compositions', () => {
  expect(resolveProfileDistributionMode('web', [], 'intranet')).toBe('intranet')
  expect(resolveProfileDistributionMode('desktop', [], 'intranet')).toBe('intranet')
  expect(resolveProfileDistributionMode('custom', ['@deepseek-ai/dsh-web-app'], 'intranet')).toBe('intranet')
  expect(resolveProfileDistributionMode('sdk', [], 'intranet')).toBe('standard')
  expect(resolveProfileDistributionMode('web', [], undefined)).toBe('standard')
  expect(() => resolveProfileDistributionMode('web', [], 'invalid')).toThrow('DSH_DISTRIBUTION_MODE')
})

it('disables aliased official modules and preserves unrelated config values without mutating input', () => {
  const entries: EntryOptions[] = [official, {
    id: 'nested', name: 'cordis:group', group: true, config: [
      { ...official, id: 'nested-account' },
      { id: 'default', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'deepseek-official', model: 'old' } },
      { id: 'llm', name: '@deepseek-ai/dsh-llm', config: { requireAvailableModel: false } },
    ],
  }, { id: 'scalar', name: 'custom-scalar', config: 'literal' },
  { id: 'absent', name: 'custom-default' }]
  expect(applyDistributionEntries(entries, 'standard')).toBe(entries)
  const effective = applyDistributionEntries(entries, 'intranet')
  expect(effective[0]?.disabled).toBe(true)
  expect(effective[1]?.config).toMatchObject([
    { disabled: true }, { config: {} }, { config: { requireAvailableModel: true } },
  ])
  expect(effective[2]?.config).toBe('literal')
  expect(effective[3]?.config).toBeUndefined()
  expect(entries[0]?.disabled).toBe(false)
  expect(applyDistributionEntries([{ ...official, name: `${official.name}/src/index.ts` }], 'intranet')[0]?.disabled).toBe(true)
  expect(applyDistributionEntries([{
    id: 'llm-subpath', name: '@deepseek-ai/dsh-llm/src/index.ts', config: { requireAvailableModel: false },
  }], 'intranet')[0]?.config).toEqual({ requireAvailableModel: true })
  expect(applyDistributionEntries([{
    id: 'custom-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'gateway', model: 'company' },
  }], 'intranet')[0]?.config).toEqual({ provider: 'gateway', model: 'company' })
})

it('reapplies the policy after profile, home and launch overlays without rewriting disk', () => {
  const home = fixture()
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  const patchPath = join(dir, 'cordis.patch.yml')
  const homePatch = join(home, 'cordis.patch.yml')
  const enable = '- id: renamed-account\n  disabled: false\n'
  writeFileSync(patchPath, enable)
  writeFileSync(homePatch, enable)
  const profile: Profile = {
    name: 'web', dir, patchPath, skippedBundles: [], patches: [{ id: official.id, disabled: false }],
    layers: [{ packageName: 'base', packageDir: home, patchPaths: [], patches: [{ insert: [official] }] }],
  }
  const context = {
    name: 'web', dir, patchPath, installAnchor: join(home, 'package.json'), home, cwd: home,
    startedBundles: ['base'], overlays: [{ id: official.id, disabled: false }],
    telemetryDisabledEnv: undefined, distributionMode: 'intranet' as const,
  }
  for (let reload = 0; reload < 2; reload++) {
    expect(composeEntries([readProfilePatches('dsh', context, profile)])[0]?.disabled).toBe(true)
    expect(readFileSync(patchPath, 'utf8')).toBe(enable)
    expect(readFileSync(homePatch, 'utf8')).toBe(enable)
  }
})

it('boots without an official model and enforces availability on subsequent Loader updates', async () => {
  const root = fixture()
  const configPath = join(root, 'cordis.yml')
  writeFileSync(configPath, '[]\n')
  const entries = applyDistributionEntries([
    official,
    { id: 'llm', name: '@deepseek-ai/dsh-llm', config: { requireAvailableModel: false } },
    { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: {
      provider: 'deepseek-account', model: 'old-official-model',
    } },
  ], 'intranet')
  const harnessBaseUrl = pathToFileURL(join(process.cwd(), 'apps/cli/package.json')).href
  const activateOfficial = vi.fn()
  const ctx = await boot('dsh', configPath, [{ insert: entries }], (host) => {
    host.provide('distributionMode', 'intranet')
    // Native Loader imports bypass Vite's source mapping. Resolve the real plugins from
    // this test's source program so the composition never consumes stale built exports.
    const internal = host.loader.internal!
    const importModule = internal.import.bind(internal)
    const spy = vi.spyOn(internal, 'import').mockImplementation(async (specifier: string, parent: string, attributes: ImportAttributes) => {
      if (specifier === '@deepseek-ai/dsh-llm') return llmModule
      if (specifier === '@deepseek-ai/dsh-agent-default-model') return defaultModelModule
      if (specifier === official.name) return { name: 'external-account', apply: activateOfficial }
      const imported: unknown = await importModule(specifier, parent, attributes)
      return imported
    })
    onTestFinished(() => { spy.mockRestore() })
  }, harnessBaseUrl)
  onTestFinished(() => ctx.fiber.dispose())
  const findEntry = (id: string) => [...ctx.loader.entries()].find(entry => entry.options.id === id)!
  const llmEntry = findEntry('llm')
  const defaultEntry = findEntry('agent-default-model')
  const llmConfig = () => llmEntry.fiber?.config as llmModule.Config | undefined
  const defaultConfig = () => defaultEntry.fiber?.config as defaultModelModule.Config | undefined
  expect(llmEntry.fiber?.state).toBe(FiberState.ACTIVE)
  expect(defaultEntry.fiber?.state).toBe(FiberState.ACTIVE)
  expect(defaultConfig()?.provider.get()).toBeUndefined()
  expect(llmConfig()?.requireAvailableModel).toBe(true)
  expect(findEntry(official.id).fiber).toBeUndefined()
  await llmEntry.update({ config: { requireAvailableModel: false } })
  await ctx.loader.await()
  expect(llmConfig()?.requireAvailableModel).toBe(true)
  await defaultEntry.update({ config: { provider: 'deepseek-official', model: 'old' } })
  await ctx.loader.await()
  expect(defaultConfig()?.provider.get()).toBeUndefined()
  await findEntry(official.id).update({ disabled: false })
  await ctx.loader.await()
  expect(activateOfficial).not.toHaveBeenCalled()
  expect(findEntry(official.id).fiber?.state).not.toBe(FiberState.ACTIVE)
  expect(readFileSync(configPath, 'utf8')).toBe('[]\n')
})
