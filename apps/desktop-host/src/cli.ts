/** Public dsh commands using the immutable runtime carried by the Desktop installation. */

import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { resolveDistributionMode } from '@deepseek-ai/dsh-launch-environment'

/**
 * Locate the archive containing a packaged runtime.
 * @param runtimeDir - Prepared or ASAR-contained runtime directory.
 * @returns Parent archive path, or undefined for a prepared directory.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' ? parent : undefined
}

/**
 * Run the ordinary CLI with Desktop's bundled package manager, fixed distribution mode and reserved-profile plugin access.
 * @param first - Prepared or ASAR-contained runtime directory (when `second` is provided), or physical Desktop support directory.
 * @param second - Physical Desktop runtime directory containing the primary-runtime payload and Node launchers.
 * @returns Completion of the selected CLI command; profile plugins own their process lifetime.
 */
export async function runDesktopCli(first: string, second?: string): Promise<void> {
  const runtimeDir = second === undefined ? undefined : first
  const supportDir = second ?? first
  const archive = runtimeDir === undefined ? undefined : runtimeArchivePath(runtimeDir)
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
  await runCli({
    manageDesktopProfile: true,
    distributionMode,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(supportDir, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
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
