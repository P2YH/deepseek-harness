/** Provision release-selected offline plugins without resolving packages on the network. */
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'

interface BundledPlugin {
  readonly name: string
  readonly version: string
  readonly sha256: string
  readonly updateExisting?: boolean
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
}

interface PluginUpdate {
  plugin: BundledPlugin
  owned: string
  destination: string
  existing: boolean
  projected: boolean
  next: string
  previous?: string
  installed: boolean
}

/**
 * Read the explicit deployment inventory, rejecting paths outside its resource tree.
 * @param directory - Physical packaged plugin resources.
 * @returns Validated deployment records.
 */
export function readBundledPlugins(directory: string): readonly BundledPlugin[] {
  const value: unknown = JSON.parse(readFileSync(join(directory, 'plugins.json'), 'utf8'))
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1
    || !('plugins' in value) || !Array.isArray(value.plugins) || value.plugins.length === 0) {
    throw new Error('desktop bundled plugins: invalid inventory')
  }
  const names = new Set<string>()
  return value.plugins.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('name' in entry) || typeof entry.name !== 'string'
      || !/^dsh-plugin-[a-z0-9-]+$/u.test(entry.name) || names.has(entry.name)
      || !('version' in entry) || typeof entry.version !== 'string'
      || !('sha256' in entry) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      || 'updateExisting' in entry && typeof entry.updateExisting !== 'boolean'
      || !('files' in entry) || !Array.isArray(entry.files) || entry.files.length === 0) {
      throw new Error('desktop bundled plugins: invalid plugin record')
    }
    names.add(entry.name)
    const files = entry.files.map((file: unknown) => {
      if (typeof file !== 'object' || file === null || !('path' in file) || typeof file.path !== 'string'
        || file.path.includes('\\') || file.path.includes(':') || file.path.split('/').some(part => !part || part === '.' || part === '..')
        || !('sha256' in file) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
        throw new Error('desktop bundled plugins: invalid file record')
      }
      return { path: file.path, sha256: file.sha256 }
    })
    return { name: entry.name, version: entry.version, sha256: entry.sha256, files,
      ...'updateExisting' in entry ? { updateExisting: entry.updateExisting as boolean } : {} }
  })
}

function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

function verifyPlugin(source: string, plugin: BundledPlugin): void {
  const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
  if (digest(join(source, 'plugin.tgz')) !== plugin.sha256) throw new Error(`desktop bundled plugins: archive mismatch for ${plugin.name}`)
  for (const file of plugin.files) {
    if (digest(join(source, 'package', ...file.path.split('/'))) !== file.sha256) {
      throw new Error(`desktop bundled plugins: file mismatch for ${plugin.name}/${file.path}`)
    }
  }
  const published = JSON.parse(readFileSync(join(source, 'package/package.json'), 'utf8')) as { name: string; version: string }
  if (published.name !== plugin.name || published.version !== plugin.version) throw new Error('desktop bundled plugins: package identity mismatch')
}

/**
 * Verify both archive and extracted resources after installer assembly.
 * @param directory - Physical resources copied by Electron Builder.
 */
export function verifyBundledPlugins(directory: string): void {
  for (const plugin of readBundledPlugins(directory)) verifyPlugin(join(directory, plugin.name), plugin)
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

/**
 * Install missing bundles and apply explicitly selected updates under the caller's profile lock.
 * Updates back up installed plugins and profile metadata; activation and prior removal choices survive.
 * Without updateExisting, existing dependencies remain unchanged. Failed commits restore prior projections and metadata.
 * @param profile - Initialized external Desktop profile.
 * @param directory - Physical packaged trees and their self-contained npm archives.
 */
export function seedBundledPlugins(profile: string, directory: string): void {
  const plugins = readBundledPlugins(directory)
  const manifestPath = join(profile, 'package.json')
  const manifest = readProfileManifest('dsh', profile)
  const dependencies = { ...manifest.dependencies }
  const bundles = [...manifest.dsh?.profile?.bundles ?? []]
  const receiptPath = join(profile, '.desktop-bundled-plugins.json')
  const receipt: unknown = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : []
  if (!Array.isArray(receipt) || receipt.some(name => typeof name !== 'string')) {
    throw new Error('desktop bundled plugins: invalid provisioning receipt')
  }
  const handled = new Set<string>(receipt as string[])
  const plans: PluginUpdate[] = []
  for (const plugin of plugins) {
    const existing = Object.hasOwn(dependencies, plugin.name)
    if (handled.has(plugin.name) && !existing) continue
    handled.add(plugin.name)
    if (existing && !plugin.updateExisting) continue
    // Keep native engine executable paths below Windows CreateProcess limits in ordinary user homes.
    const location = plugin.sha256.slice(0, 20)
    const owned = join(profile, '.desktop-bundles', location)
    const destination = join(profile, 'node_modules', plugin.name)
    const selected = `file:./.desktop-bundles/${location}/plugin.tgz`
    const projected = existsSync(destination) && lstatSync(destination).isSymbolicLink()
      && existsSync(join(owned, 'package')) && realpathSync(destination) === realpathSync(join(owned, 'package'))
    if (existing && dependencies[plugin.name] === selected && projected) continue
    if (!existing && pathExists(destination) && !projected) {
      throw new Error(`desktop bundled plugins: undeclared package already exists: ${plugin.name}`)
    }
    verifyPlugin(join(directory, plugin.name), plugin)
    plans.push({ plugin, owned, destination, existing, projected, next: `${destination}.${randomUUID()}.tmp`, installed: false })
    dependencies[plugin.name] = selected
    if (!existing && !bundles.includes(plugin.name)) bundles.push(plugin.name)
  }
  // All release resources are verified before changing any installed module.
  for (const plan of plans) {
    if (!existsSync(plan.owned)) {
      mkdirSync(join(profile, '.desktop-bundles'), { recursive: true })
      const stage = `${plan.owned}.${randomUUID()}.tmp`
      cpSync(join(directory, plan.plugin.name), stage, { recursive: true })
      verifyPlugin(stage, plan.plugin)
      renameSync(stage, plan.owned)
    } else verifyPlugin(plan.owned, plan.plugin)
  }
  const originalManifest = readFileSync(manifestPath)
  const originalReceipt = existsSync(receiptPath) ? readFileSync(receiptPath) : undefined
  const backup = plans.some(plan => plan.existing)
    ? join(profile, '.desktop-plugin-backups', `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}`) : undefined
  if (backup !== undefined) {
    mkdirSync(join(backup, 'node_modules'), { recursive: true })
    for (const file of ['package.json', 'pnpm-lock.yaml', 'cordis.yml', 'cordis.patch.yml', '.desktop-bundled-plugins.json']) {
      if (existsSync(join(profile, file))) cpSync(join(profile, file), join(backup, file))
    }
  }
  try {
    for (const plan of plans) {
      if (plan.projected) continue
      mkdirSync(join(profile, 'node_modules'), { recursive: true })
      symlinkSync(join(plan.owned, 'package'), plan.next, process.platform === 'win32' ? 'junction' : 'dir')
      if (pathExists(plan.destination)) {
        if (backup === undefined) throw new Error(`desktop bundled plugins: destination changed: ${plan.plugin.name}`)
        const previous = join(backup, 'node_modules', plan.plugin.name)
        renameSync(plan.destination, previous)
        plan.previous = previous
      }
      renameSync(plan.next, plan.destination)
      plan.installed = true
    }
    if (plans.length) {
      writeJson(manifestPath, { ...manifest, dependencies, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } } })
    }
    if (handled.size !== receipt.length) writeJson(receiptPath, [...handled])
  } catch (error) {
    const failures: unknown[] = [error]
    for (const plan of plans.toReversed()) {
      try {
        if (plan.installed) unlinkSync(plan.destination)
        if (plan.previous !== undefined) renameSync(plan.previous, plan.destination)
      } catch (rollbackError) { failures.push(rollbackError) }
    }
    try {
      writeFileSync(manifestPath, originalManifest)
      if (originalReceipt !== undefined) writeFileSync(receiptPath, originalReceipt)
      else if (existsSync(receiptPath)) unlinkSync(receiptPath)
    } catch (rollbackError) { failures.push(rollbackError) }
    if (failures.length > 1) throw new AggregateError(failures, `desktop bundled plugins: rollback incomplete; backup: ${backup ?? profile}`)
    throw error
  } finally {
    for (const plan of plans) if (pathExists(plan.next)) unlinkSync(plan.next)
  }
}
