/** Public dsh commands using the immutable runtime carried by the Desktop installation. */

import { delimiter, dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { resolveDistributionMode } from '@deepseek-ai/dsh-launch-environment'
import { installOfficeEngineResolution, runtimeArchivePath } from './office-engine.ts'

/**
 * Run the ordinary CLI with Desktop's bundled package manager, fixed distribution mode and reserved-profile plugin access.
 * @param runtimeDir - Prepared or ASAR-contained production DSH package tree.
 * @param supportDir - Physical Desktop runtime directory containing pnpm.
 * @returns Completion of the selected CLI command; profile plugins own their process lifetime.
 */
export async function runDesktopCli(runtimeDir: string, supportDir: string): Promise<void> {
  const archive = runtimeArchivePath(runtimeDir)
  let modeInput: unknown = process.env.DSH_DISTRIBUTION_MODE
  if (archive !== undefined) {
    const manifest: unknown = JSON.parse(readFileSync(join(archive, 'package.json'), 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop: invalid application manifest')
    modeInput = 'dshDistributionMode' in manifest ? manifest.dshDistributionMode : undefined
  }
  if (modeInput !== undefined && typeof modeInput !== 'string') {
    throw new Error('desktop: invalid distribution mode in application manifest')
  }
  const distributionMode = resolveDistributionMode(modeInput)
  process.env.DSH_DISTRIBUTION_MODE = distributionMode
  installOfficeEngineResolution(runtimeDir)
  await runCli({
    manageDesktopProfile: true,
    distributionMode,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(supportDir, 'pnpm', 'bin', 'pnpm.mjs')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DISTRIBUTION_MODE: distributionMode,
        DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
        PATH: `${join(supportDir, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  })
}

if (import.meta.main) {
  if (process.platform === 'win32') {
    const { installWindowsCliSignals } = await import('./windows-cli-signals.ts')
    await installWindowsCliSignals()
  }
  const runtimeDir = resolve(import.meta.dirname, '../../../..')
  await runDesktopCli(runtimeDir, join(dirname(runtimeArchivePath(runtimeDir) ?? runtimeDir), 'runtime'))
}
