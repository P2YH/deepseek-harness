/** Resolve an explicit intranet offline-plugin deployment directory. */
import { existsSync, readFileSync, statSync } from 'node:fs'
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
  if (![1, 2].includes(inventory.schemaVersion) || !Array.isArray(inventory.plugins) || inventory.plugins.length < 2 || inventory.plugins.length > 10
    || new Set(inventory.plugins.map(plugin => plugin.name)).size !== inventory.plugins.length
    || inventory.plugins.some(plugin => !['dsh-plugin-office-agents', 'dsh-plugin-architecture-review', 'dsh-plugin-easyview', 'dsh-plugin-tasks',
      'dsh-plugin-document-editor', 'dsh-plugin-pdf-editor', 'dsh-plugin-presentation-editor', 'dsh-plugin-spreadsheet-editor', 'dsh-plugin-ppt', 'dsh-pet'].includes(plugin.name))
    || !inventory.plugins.some(plugin => plugin.name === 'dsh-plugin-architecture-review')
    || !inventory.plugins.some(plugin => ['dsh-plugin-office-agents', 'dsh-plugin-easyview'].includes(plugin.name))
    || (inventory.plugins.some(plugin => plugin.name === 'dsh-plugin-office-agents')
      && !inventory.plugins.some(plugin => plugin.name === 'dsh-plugin-tasks'))) {
    throw new Error('desktop package: architecture review, a supported document workbench, and tasks when Office Agents is bundled are required')
  }
  if (inventory.plugins.some(plugin => plugin.name === 'dsh-plugin-ppt')
    && !inventory.plugins.some(plugin => plugin.name === 'dsh-plugin-presentation-editor')) {
    throw new Error('desktop package: PPT expert requires the presentation editor')
  }
  for (const plugin of inventory.plugins) {
    if (!statSync(join(directory, plugin.name, 'plugin.tgz')).isFile()) throw new Error('desktop package: missing bundled plugin archive')
    const packageDirectory = join(directory, plugin.name, 'package')
    if (inventory.schemaVersion === 1 ? !statSync(packageDirectory).isDirectory() : existsSync(packageDirectory)) {
      throw new Error('desktop package: bundled plugin storage does not match its inventory version')
    }
    if (plugin.name === 'dsh-pet' && (!Array.isArray(plugin.electronFiles) || !plugin.electronFiles.length
      || !statSync(join(directory, plugin.name, 'electron/electron.exe')).isFile())) {
      throw new Error('desktop package: missing bundled pet Electron runtime')
    }
  }
  return directory
}
