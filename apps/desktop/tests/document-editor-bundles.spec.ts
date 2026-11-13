import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { resolveBundledPluginsDirectory } from '../scripts/bundled-plugins.mjs'
import { verifyBundledPlugins } from '../src/bundled-plugins.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runtimeFixture } from './runtime-fixture.ts'

it.skipIf(process.platform !== 'win32')('prepares, verifies and provisions Office with four independent document editors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-editor-bundles-'))
  const names = ['dsh-plugin-office-agents', 'dsh-plugin-architecture-review', 'dsh-plugin-tasks',
    'dsh-plugin-document-editor', 'dsh-plugin-pdf-editor', 'dsh-plugin-presentation-editor', 'dsh-plugin-spreadsheet-editor']
  try {
    const archives = names.map((name) => {
      const source = join(root, name)
      mkdirSync(join(source, 'package/lib'), { recursive: true })
      writeFileSync(join(source, 'package/package.json'), JSON.stringify({ name, version: '1.0.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      writeFileSync(join(source, 'package/cordis.patch.yml'), '[]\n')
      writeFileSync(join(source, 'package/lib/index.js'), 'export default {}\n')
      const archive = join(root, name + '.tgz')
      execFileSync('tar.exe', ['-czf', archive, '-C', source, 'package'], { windowsHide: true })
      return archive
    })
    const resources = join(root, 'bundled-plugins')
    const prepare = fileURLToPath(new URL('../scripts/prepare-bundled-plugins.mjs', import.meta.url))
    execFileSync(process.execPath, [prepare, resources, ...archives], { windowsHide: true })
    expect(resolveBundledPluginsDirectory({ DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: resources })).toBe(resources)
    verifyBundledPlugins(resources)
    const dsh = join(root, 'runtime')
    runtimeFixture(dsh)
    const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, 'home')), { dsh, bundledPlugins: resources })
    await manager.applyRelease()
    const manifest = JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    for (const name of names) {
      expect(manifest.dsh.profile.bundles).toContain(name)
      expect(manifest.dependencies[name]).toMatch(/^file:\.\/\.desktop-bundles\//u)
    }
    const inventoryFile = join(resources, 'plugins.json')
    const inventory = JSON.parse(readFileSync(inventoryFile, 'utf8')) as { plugins: { name: string }[] }
    inventory.plugins[0]!.name = 'dsh-plugin-unrecognized'
    writeFileSync(inventoryFile, JSON.stringify(inventory))
    expect(() => resolveBundledPluginsDirectory({ DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: resources })).toThrow(/required/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
