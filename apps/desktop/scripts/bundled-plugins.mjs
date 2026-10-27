/** Resolve an explicit intranet offline-plugin deployment directory. */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDesktopDistributionMode } from './desktop-distribution-mode.mjs'

/**
 * Validate the selected deployment before Electron packaging starts.
 * @param {NodeJS.ProcessEnv} environment - File-owned packaging settings.
 * @returns {string | undefined} Plugin resource directory, when selected.
 */
export function resolveBundledPluginsDirectory(environment) {
  const directory = environment.DSH_DESKTOP_BUNDLED_PLUGINS_DIR
  if (!directory) return undefined
  if (resolveDesktopDistributionMode(environment) !== 'intranet') throw new Error('desktop package: bundled plugins require intranet mode')
  const inventory = JSON.parse(readFileSync(join(directory, 'plugins.json'), 'utf8'))
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.plugins) || ![2, 3].includes(inventory.plugins.length)
    || new Set(inventory.plugins.map(plugin => plugin.name)).size !== inventory.plugins.length
    || inventory.plugins.some(plugin => !['dsh-plugin-office-agents', 'dsh-plugin-architecture-review', 'dsh-pet'].includes(plugin.name))
    || ['dsh-plugin-office-agents', 'dsh-plugin-architecture-review'].some(name => !inventory.plugins.some(plugin => plugin.name === name))) {
    throw new Error('desktop package: office and architecture review bundles are required')
  }
  for (const plugin of inventory.plugins) {
    if (!statSync(join(directory, plugin.name, 'plugin.tgz')).isFile()
      || !statSync(join(directory, plugin.name, 'package')).isDirectory()) throw new Error('desktop package: missing bundled plugin resources')
    if (plugin.name === 'dsh-pet' && (!Array.isArray(plugin.electronFiles) || !plugin.electronFiles.length
      || !statSync(join(directory, plugin.name, 'electron/electron.exe')).isFile())) {
      throw new Error('desktop package: missing bundled pet Electron runtime')
    }
  }
  return directory
}
