import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runtimeFixture } from './runtime-fixture.ts'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { loadDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'

const roots: string[] = []
const failure = vi.hoisted(() => ({ receipt: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: (from: string, to: string) => {
    if (failure.receipt && to.endsWith('.desktop-bundled-plugins.json')) throw new Error('receipt commit unavailable')
    actual.renameSync(from, to)
  } }
})
afterEach(() => { failure.receipt = false; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bundled-plugins-'))
  roots.push(root)
  const resources = join(root, 'resources')
  const dsh = join(root, 'runtime')
  runtimeFixture(dsh)
  const plugins = ['dsh-plugin-office-agents', 'dsh-plugin-architecture-review'].map((name) => {
    const directory = join(resources, name)
    mkdirSync(join(directory, 'package/lib'), { recursive: true })
    writeFileSync(join(directory, 'plugin.tgz'), name)
    const contents = {
      'package.json': JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
      'lib/index.js': 'export const name = "plugin"\n',
      'cordis.patch.yml': '[]\n',
    }
    const hash = (body: string): string => createHash('sha256').update(body).digest('hex')
    const files = Object.entries(contents).map(([path, content]) => {
      writeFileSync(join(directory, 'package', path), content)
      return { path, sha256: hash(content) }
    })
    return { name, version: '1.0.0', sha256: hash(name), files }
  })
  writeFileSync(join(resources, 'plugins.json'), JSON.stringify({ schemaVersion: 1, plugins }))
  const paths = resolveDesktopPaths(join(root, 'home'))
  const manager = new DesktopProjectManager(paths, { dsh, bundledPlugins: resources })
  const manifest = () => JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  return { root, resources, manager, manifest }
}

function enableBundledUpgrades(resources: string): void {
  const file = join(resources, 'plugins.json')
  const inventory = JSON.parse(readFileSync(file, 'utf8')) as { plugins: { updateExisting?: boolean }[] }
  for (const plugin of inventory.plugins) plugin.updateExisting = true
  writeFileSync(file, JSON.stringify(inventory))
}

it('upgrades installed deployment plugins with backups while retaining disabled choices and business data', async () => {
  const { resources, manager, manifest } = setup()
  await new DesktopProjectManager(manager.paths, { dsh: manager.runtime.dsh }).applyRelease()
  const current = manifest()
  current.dependencies['dsh-plugin-office-agents'] = 'file:./legacy-office.tgz'
  current.dependencies.custom = '1.2.3'
  current.dsh.profile.bundles.push('custom')
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify(current))
  const legacy = join(manager.paths.profile, 'node_modules/dsh-plugin-office-agents')
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'legacy.txt'), 'old spawn implementation')
  writeFileSync(join(manager.paths.profile, 'cordis.patch.yml'), '# existing models\n[]\n')
  mkdirSync(join(manager.paths.home, 'office-agents'))
  writeFileSync(join(manager.paths.home, 'office-agents/ppt-workbench.json'), '{"projects":[{"id":"kept"}]}')
  enableBundledUpgrades(resources)
  await manager.applyRelease()
  expect(readFileSync(join(legacy, 'lib/index.js'), 'utf8')).toContain('export const name')
  expect(manifest().dependencies['dsh-plugin-office-agents']).toMatch(/^file:\.\/\.desktop-bundles\//u)
  expect(manifest().dependencies.custom).toBe('1.2.3')
  expect(manifest().dsh.profile.bundles).not.toContain('dsh-plugin-office-agents')
  expect(manifest().dsh.profile.bundles).toContain('custom')
  expect(readFileSync(join(manager.paths.profile, 'cordis.patch.yml'), 'utf8')).toBe('# existing models\n[]\n')
  expect(readFileSync(join(manager.paths.home, 'office-agents/ppt-workbench.json'), 'utf8')).toBe('{"projects":[{"id":"kept"}]}')
  const backups = readdirSync(join(manager.paths.profile, '.desktop-plugin-backups'))
  expect(backups).toHaveLength(1)
  const backup = join(manager.paths.profile, '.desktop-plugin-backups', backups[0]!)
  expect(readFileSync(join(backup, 'node_modules/dsh-plugin-office-agents/legacy.txt'), 'utf8')).toBe('old spawn implementation')
  expect(JSON.parse(readFileSync(join(backup, 'package.json'), 'utf8'))).toEqual(current)
  await manager.applyRelease()
  expect(readdirSync(join(manager.paths.profile, '.desktop-plugin-backups'))).toEqual(backups)
})

it('upgrades a previously provisioned bundle even when the development version is unchanged', async () => {
  const { resources, manager, manifest } = setup()
  await manager.applyRelease()
  const previous = manifest().dependencies['dsh-plugin-office-agents']
  const inventoryPath = join(resources, 'plugins.json')
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
    plugins: { name: string; sha256: string; updateExisting?: boolean; files: { path: string; sha256: string }[] }[]
  }
  const office = inventory.plugins.find(plugin => plugin.name === 'dsh-plugin-office-agents')!
  office.updateExisting = true
  const body = 'export const name = "updated ordinary session implementation"\n'
  writeFileSync(join(resources, office.name, 'package/lib/index.js'), body)
  office.files.find(file => file.path === 'lib/index.js')!.sha256 = createHash('sha256').update(body).digest('hex')
  writeFileSync(join(resources, office.name, 'plugin.tgz'), 'new same-version archive')
  office.sha256 = createHash('sha256').update('new same-version archive').digest('hex')
  writeFileSync(inventoryPath, JSON.stringify(inventory))
  await manager.applyRelease()
  expect(manifest().dependencies[office.name]).not.toBe(previous)
  expect(readFileSync(join(manager.paths.profile, 'node_modules', office.name, 'lib/index.js'), 'utf8')).toBe(body)
  const removed = manifest()
  delete removed.dependencies['dsh-plugin-office-agents']
  removed.dsh.profile.bundles = removed.dsh.profile.bundles.filter(name => name !== office.name)
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify(removed))
  await manager.applyRelease()
  expect(manifest().dependencies).not.toHaveProperty(office.name)
})

it('rejects damaged upgrade resources before changing any installed plugin', async () => {
  const { resources, manager, manifest } = setup()
  await new DesktopProjectManager(manager.paths, { dsh: manager.runtime.dsh }).applyRelease()
  const current = manifest()
  current.dependencies['dsh-plugin-office-agents'] = 'file:./legacy-office.tgz'
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify(current))
  const legacy = join(manager.paths.profile, 'node_modules/dsh-plugin-office-agents')
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'legacy.txt'), 'preserved')
  enableBundledUpgrades(resources)
  writeFileSync(join(resources, 'dsh-plugin-architecture-review/package/lib/index.js'), 'damaged')
  await expect(manager.applyRelease()).rejects.toThrow(/file mismatch/u)
  expect(manifest()).toEqual(current)
  expect(readFileSync(join(legacy, 'legacy.txt'), 'utf8')).toBe('preserved')
  expect(existsSync(manager.paths.lock)).toBe(false)
})

it('restores plugin projections and metadata when the provisioning receipt cannot commit', async () => {
  const { resources, manager, manifest } = setup()
  await new DesktopProjectManager(manager.paths, { dsh: manager.runtime.dsh }).applyRelease()
  const current = manifest()
  current.dependencies['dsh-plugin-office-agents'] = 'file:./legacy-office.tgz'
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify(current))
  const legacy = join(manager.paths.profile, 'node_modules/dsh-plugin-office-agents')
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'legacy.txt'), 'preserved')
  enableBundledUpgrades(resources)
  failure.receipt = true
  await expect(manager.applyRelease()).rejects.toThrow('receipt commit unavailable')
  expect(manifest()).toEqual(current)
  expect(readFileSync(join(legacy, 'legacy.txt'), 'utf8')).toBe('preserved')
  expect(existsSync(join(manager.paths.profile, 'node_modules/dsh-plugin-architecture-review'))).toBe(false)
  expect(existsSync(join(manager.paths.profile, '.desktop-bundled-plugins.json'))).toBe(false)
  expect(existsSync(manager.paths.lock)).toBe(false)
  failure.receipt = false
  await manager.applyRelease()
  expect(readFileSync(join(legacy, 'lib/index.js'), 'utf8')).toContain('export const name')
})

it('provisions both plugins before Host startup and keeps offline sources in the profile', async () => {
  const { manager, manifest } = setup()
  await manager.applyRelease()
  const result = manifest()
  expect(result.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-office-agents', 'dsh-plugin-architecture-review'])
  for (const name of ['dsh-plugin-office-agents', 'dsh-plugin-architecture-review']) {
    expect(readFileSync(join(manager.paths.profile, 'node_modules', name, 'lib/index.js'), 'utf8')).toContain('export const name')
    expect(existsSync(join(manager.paths.profile, result.dependencies[name]!.slice(5)))).toBe(true)
  }
  const before = JSON.stringify(result)
  await manager.applyRelease()
  expect(JSON.stringify(manifest())).toBe(before)
  await manager.disableAllPlugins()
  await manager.applyRelease()
  expect(manifest().dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
})

it('preserves existing plugin versions, disabled choices, patches, and business data during upgrade', async () => {
  const { manager, manifest } = setup()
  const plain = new DesktopProjectManager(manager.paths, { dsh: manager.runtime.dsh })
  await plain.applyRelease()
  const current = manifest()
  current.dependencies['dsh-plugin-office-agents'] = 'file:./custom-office.tgz'
  current.dependencies.other = '1.2.3'
  current.dsh.profile.bundles.push('other')
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify(current))
  writeFileSync(join(manager.paths.profile, 'cordis.patch.yml'), '# User patch\n[]\n')
  const business = join(manager.paths.home, 'office-agents')
  mkdirSync(business)
  writeFileSync(join(business, 'tasks.json'), '{"preserved":true}')
  await manager.applyRelease()
  expect(manifest().dependencies['dsh-plugin-office-agents']).toBe('file:./custom-office.tgz')
  expect(manifest().dsh.profile.bundles).not.toContain('dsh-plugin-office-agents')
  expect(manifest().dsh.profile.bundles).toContain('dsh-plugin-architecture-review')
  expect(manifest().dsh.profile.bundles).toContain('other')
  expect(readFileSync(join(manager.paths.profile, 'cordis.patch.yml'), 'utf8')).toBe('# User patch\n[]\n')
  expect(readFileSync(join(business, 'tasks.json'), 'utf8')).toBe('{"preserved":true}')
  const removed = manifest()
  delete removed.dependencies['dsh-plugin-architecture-review']
  removed.dsh.profile.bundles = removed.dsh.profile.bundles.filter(name => name !== 'dsh-plugin-architecture-review')
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify(removed))
  await manager.applyRelease()
  expect(manifest().dependencies).not.toHaveProperty('dsh-plugin-architecture-review')
})

it('rejects damaged deployment bytes before enabling a plugin', async () => {
  const { resources, manager, manifest } = setup()
  writeFileSync(join(resources, 'dsh-plugin-office-agents/package/lib/index.js'), 'damaged')
  await expect(manager.applyRelease()).rejects.toThrow(/file mismatch/u)
  expect(manifest().dsh.profile.bundles).not.toContain('dsh-plugin-office-agents')
  expect(existsSync(manager.paths.lock)).toBe(false)
})

it('accepts an existing profile that has bundles and no dependencies field', async () => {
  const { manager, manifest } = setup()
  await new DesktopProjectManager(manager.paths, { dsh: manager.runtime.dsh }).applyRelease()
  writeFileSync(join(manager.paths.profile, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
  await manager.applyRelease()
  expect(manifest().dsh.profile.bundles).toContain('dsh-plugin-architecture-review')
})

it('ships only explicitly configured intranet resources and resolves file-owned paths', () => {
  const { root, resources } = setup()
  const env = { DSH_DESKTOP_APP_ID: 'com.example.intranet', DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: resources }
  const config = createElectronBuilderConfig(env, 'win32', 'x64')
  expect(config.extraMetadata.dshBundledPlugins).toBe(true)
  expect(config.extraResources).toContainEqual({ from: resources, to: 'bundled-plugins' })
  expect(() => createElectronBuilderConfig({ ...env, DSH_DISTRIBUTION_MODE: 'standard' }, 'win32', 'x64')).toThrow(/require intranet mode/u)
  writeFileSync(join(root, '.env.windows'), 'DSH_DISTRIBUTION_MODE=intranet\nDSH_DESKTOP_BUNDLED_PLUGINS_DIR=resources\n')
  expect(loadDesktopPackageEnvironment('win32', {}, root).DSH_DESKTOP_BUNDLED_PLUGINS_DIR).toBe(resources)
  writeFileSync(join(root, '.env.windows'), 'DSH_DISTRIBUTION_MODE=intranet\n')
  expect(loadDesktopPackageEnvironment('win32', env, root)).not.toHaveProperty('DSH_DESKTOP_BUNDLED_PLUGINS_DIR')
})
