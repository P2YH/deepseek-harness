import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { resolveBundledPluginsDirectory } from '../scripts/bundled-plugins.mjs'
import { verifyBundledPlugins } from '../src/bundled-plugins.ts'

it.skipIf(process.platform !== 'win32')('packages the native PPT expert with its editor and rejects an incomplete deployment', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-ppt-bundle-'))
  const names = ['dsh-plugin-architecture-review', 'dsh-plugin-easyview', 'dsh-plugin-presentation-editor', 'dsh-plugin-ppt']
  try {
    const archives = names.map((name) => {
      const directory = join(root, name)
      mkdirSync(join(directory, 'package/lib'), { recursive: true })
      writeFileSync(join(directory, 'package/package.json'), JSON.stringify({ name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      writeFileSync(join(directory, 'package/cordis.patch.yml'), '[]\n')
      writeFileSync(join(directory, 'package/lib/index.js'), 'export default {}\n')
      const archive = join(root, name + '.tgz')
      execFileSync('tar.exe', ['-czf', archive, '-C', directory, 'package'], { windowsHide: true })
      return archive
    })
    const directory = join(root, 'resources'), prepare = fileURLToPath(new URL('../scripts/prepare-bundled-plugins.mjs', import.meta.url))
    execFileSync(process.execPath, [prepare, directory, ...archives], { windowsHide: true })
    const environment = { DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: directory }
    expect(resolveBundledPluginsDirectory(environment)).toBe(directory)
    verifyBundledPlugins(directory)
    const inventoryFile = join(directory, 'plugins.json')
    const inventory = JSON.parse(readFileSync(inventoryFile, 'utf8')) as { plugins: { name: string }[] }
    inventory.plugins = inventory.plugins.filter(plugin => plugin.name !== 'dsh-plugin-presentation-editor')
    writeFileSync(inventoryFile, JSON.stringify(inventory))
    expect(() => resolveBundledPluginsDirectory(environment)).toThrow(/requires the presentation editor/u)
    expect(() => execFileSync(process.execPath, [prepare, join(root, 'incomplete'), ...archives.filter(file => file !== join(root, 'dsh-plugin-presentation-editor.tgz'))], { windowsHide: true, stdio: 'pipe' })).toThrow()
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + '\\')) rmSync(root, { recursive: true, force: true })
  }
})
