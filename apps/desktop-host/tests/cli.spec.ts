/** Desktop's terminal entry keeps the installed distribution mode for CLI and package operations. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { runDesktopCli } from '../src/cli.ts'

const { runCli, installOfficeEngineResolution } = vi.hoisted(() => ({
  runCli: vi.fn<typeof import('@deepseek-ai/dsh/lib/bin.js')['runCli']>(async () => {}),
  installOfficeEngineResolution: vi.fn(),
}))

vi.mock('@deepseek-ai/dsh/lib/bin.js', () => ({ runCli }))
vi.mock('../src/office-engine.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/office-engine.ts')>(),
  installOfficeEngineResolution,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

function fixture(manifest?: object) {
  const root = mkdtempSync(join(tmpdir(), 'desktop-cli-distribution-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const runtime = manifest === undefined ? join(root, 'dsh') : join(root, 'app.asar', 'dsh')
  mkdirSync(runtime, { recursive: true })
  if (manifest !== undefined) writeFileSync(join(root, 'app.asar', 'package.json'), JSON.stringify(manifest))
  return { runtime, support: join(root, 'runtime') }
}

it.each([undefined, 'standard'])('keeps packaged intranet mode with ambient mode %s', async (ambient) => {
  vi.stubEnv('DSH_DISTRIBUTION_MODE', ambient)
  const f = fixture({ dshDistributionMode: 'intranet' })
  await runDesktopCli(f.runtime, f.support)
  expect(process.env.DSH_DISTRIBUTION_MODE).toBe('intranet')
  expect(runCli).toHaveBeenCalledOnce()
  const options = runCli.mock.calls[0]?.[0]
  expect(options).toMatchObject({
    manageDesktopProfile: true,
    distributionMode: 'intranet',
  })
  expect(options?.packageManager?.env).toMatchObject({ DSH_DISTRIBUTION_MODE: 'intranet' })
  expect(installOfficeEngineResolution).toHaveBeenCalledWith(f.runtime)
})

it.each([{ dshDistributionMode: 'standard' }, {}])('keeps packaged standard mode with manifest %j', async (manifest) => {
  vi.stubEnv('DSH_DISTRIBUTION_MODE', 'intranet')
  const f = fixture(manifest)
  await runDesktopCli(f.runtime, f.support)
  expect(process.env.DSH_DISTRIBUTION_MODE).toBe('standard')
  expect(runCli).toHaveBeenCalledWith(expect.objectContaining({ distributionMode: 'standard' }))
})

it.each([undefined, 'intranet'])('uses inherited mode %s for a prepared development runtime', async (ambient) => {
  vi.stubEnv('DSH_DISTRIBUTION_MODE', ambient)
  const f = fixture()
  await runDesktopCli(f.runtime, f.support)
  expect(runCli).toHaveBeenCalledWith(expect.objectContaining({ distributionMode: ambient ?? 'standard' }))
})

it.each([false, 'offline'])('rejects invalid packaged mode %s before CLI dispatch', async (mode) => {
  vi.stubEnv('DSH_DISTRIBUTION_MODE', 'standard')
  const f = fixture({ dshDistributionMode: mode })
  await expect(runDesktopCli(f.runtime, f.support)).rejects.toThrow(/distribution mode|DSH_DISTRIBUTION_MODE/u)
  expect(runCli).not.toHaveBeenCalled()
  expect(installOfficeEngineResolution).not.toHaveBeenCalled()
})
