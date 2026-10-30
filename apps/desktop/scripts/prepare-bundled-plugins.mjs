/** Materialize verified offline plugin archives and an optional pet ZIP as installer resources. */
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveBundledPluginsDirectory } from './bundled-plugins.mjs'

const [output, firstArchive, secondArchive, petZip] = process.argv.slice(2)
if (!output || !firstArchive || !secondArchive) throw new Error('Usage: node prepare-bundled-plugins.mjs <new-output-directory> <architecture-review.tgz> <easyview-or-office.tgz> [pet-offline.zip]')
const directory = resolve(output)
if (existsSync(directory)) throw new Error('desktop bundled plugins: output already exists')
mkdirSync(directory, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const plugins = []
function filesIn(root) {
  const files = []
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = prefix + entry.name
      if (entry.isDirectory()) visit(join(directory, entry.name), file + '/')
      else if (entry.isFile()) files.push({ path: file, sha256: hash(readFileSync(join(directory, entry.name))) })
      else throw new Error(`Plugin contains a non-regular entry: ${file}`)
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}
function safeEntries(archive, packageOnly) {
  const entries = execFileSync('tar.exe', ['-tf', resolve(archive)], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).trim().split(/\r?\n/u)
  if (entries.some(entry => packageOnly && !entry.startsWith('package/') || entry.startsWith('/') || entry.includes('\\') || entry.includes(':')
    || entry.replace(/\/$/u, '').split('/').some(part => !part || part === '..' || part === '.'))) throw new Error('Invalid archive paths')
  return entries
}
function addPlugin(name, archive) {
  const target = join(directory, name)
  mkdirSync(target)
  safeEntries(archive, true)
  execFileSync('tar.exe', ['-xzf', resolve(archive), '-C', target], { windowsHide: true })
  copyFileSync(resolve(archive), join(target, 'plugin.tgz'))
  const manifest = JSON.parse(readFileSync(join(target, 'package/package.json'), 'utf8'))
  if (manifest.name !== name || !manifest.dsh?.bundle?.patch) throw new Error(`Invalid plugin manifest: ${name}`)
  const plugin = { name, version: manifest.version, sha256: hash(readFileSync(archive)), updateExisting: true, files: filesIn(join(target, 'package')) }
  plugins.push(plugin)
  return plugin
}
function archivePackageName(archive) {
  const manifest = execFileSync('tar.exe', ['-xOf', resolve(archive), 'package/package.json'], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(manifest).name
}
const archives = new Map([[archivePackageName(firstArchive), firstArchive], [archivePackageName(secondArchive), secondArchive]])
if (!archives.has('dsh-plugin-architecture-review')) throw new Error('Bundled plugin preparation requires dsh-plugin-architecture-review')
const documentWorkbench = archives.has('dsh-plugin-easyview') ? 'dsh-plugin-easyview' : 'dsh-plugin-office-agents'
if (!archives.has(documentWorkbench)) throw new Error('Bundled plugin preparation requires dsh-plugin-easyview or dsh-plugin-office-agents')
addPlugin('dsh-plugin-architecture-review', archives.get('dsh-plugin-architecture-review'))
addPlugin(documentWorkbench, archives.get(documentWorkbench))
if (petZip) {
  safeEntries(petZip, false)
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-pet-bundle-'))
  try {
    execFileSync('tar.exe', ['-xf', resolve(petZip), '-C', temporary], { windowsHide: true })
    const checks = JSON.parse(readFileSync(join(temporary, 'checksums.json'), 'utf8'))
    const files = filesIn(temporary)
    for (const file of files.filter(file => file.path.startsWith('electron/') || file.path.endsWith('.tgz'))) {
      if (checks[file.path] !== file.sha256) throw new Error(`Pet offline checksum mismatch: ${file.path}`)
    }
    for (const name of Object.keys(checks)) {
      if (!files.some(file => file.path === name)) throw new Error(`Missing pet offline file: ${name}`)
    }
    const archives = files.filter(file => file.path.endsWith('.tgz') && !file.path.includes('/'))
    if (archives.length !== 1) throw new Error('Pet offline ZIP must contain exactly one plugin archive')
    const plugin = addPlugin('dsh-pet', join(temporary, archives[0].path))
    cpSync(join(temporary, 'electron'), join(directory, 'dsh-pet/electron'), { recursive: true })
    plugin.electronFiles = filesIn(join(directory, 'dsh-pet/electron'))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
writeFileSync(join(directory, 'plugins.json'), JSON.stringify({ schemaVersion: 1, plugins }, null, 2) + '\n')
resolveBundledPluginsDirectory({ DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: directory })
console.log(JSON.stringify({ directory, plugins: plugins.map(({ files, electronFiles, ...plugin }) => ({ ...plugin, files: files.length,
  ...electronFiles === undefined ? {} : { electronFiles: electronFiles.length } })) }, null, 2))
