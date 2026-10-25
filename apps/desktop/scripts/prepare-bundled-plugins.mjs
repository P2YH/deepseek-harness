/** Materialize two verified offline npm archives as physical installer resources. */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveBundledPluginsDirectory } from './bundled-plugins.mjs'

const [output, office, review] = process.argv.slice(2)
if (!output || !office || !review) throw new Error('Usage: node prepare-bundled-plugins.mjs <new-output-directory> <office.tgz> <review.tgz>')
const directory = resolve(output)
if (existsSync(directory)) throw new Error('desktop bundled plugins: output already exists')
mkdirSync(directory, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const plugins = []
for (const [name, archive] of [['dsh-plugin-office-agents', office], ['dsh-plugin-architecture-review', review]]) {
  const target = join(directory, name)
  mkdirSync(target)
  const entries = execFileSync('tar.exe', ['-tzf', resolve(archive)], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/u)
  if (entries.some(entry => !entry.startsWith('package/') || entry.includes('\\') || entry.includes(':')
    || entry.split('/').some(part => part === '..' || part === '.'))) throw new Error(`Invalid archive paths for ${name}`)
  execFileSync('tar.exe', ['-xzf', resolve(archive), '-C', target], { windowsHide: true })
  copyFileSync(resolve(archive), join(target, 'plugin.tgz'))
  const manifest = JSON.parse(readFileSync(join(target, 'package/package.json'), 'utf8'))
  if (manifest.name !== name || !manifest.dsh?.bundle?.patch) throw new Error(`Invalid plugin manifest: ${name}`)
  const files = []
  function inventory(root, prefix = '') {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = prefix + entry.name
      if (entry.isDirectory()) inventory(join(root, entry.name), file + '/')
      else if (entry.isFile()) files.push({ path: file, sha256: hash(readFileSync(join(root, entry.name))) })
      else throw new Error(`Plugin contains a non-regular entry: ${file}`)
    }
  }
  inventory(join(target, 'package'))
  files.sort((left, right) => left.path.localeCompare(right.path))
  plugins.push({ name, version: manifest.version, sha256: hash(readFileSync(archive)), updateExisting: true, files })
}
writeFileSync(join(directory, 'plugins.json'), JSON.stringify({ schemaVersion: 1, plugins }, null, 2) + '\n')
resolveBundledPluginsDirectory({ DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: directory })
console.log(JSON.stringify({ directory, plugins: plugins.map(({ files, ...plugin }) => ({ ...plugin, files: files.length })) }, null, 2))
