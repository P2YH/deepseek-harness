/** Offline provisioning runs in Electron's browser process, where node:fs virtualizes ASAR paths. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
const { createPackage } = builderRequire('@electron/asar') as {
  createPackage: (source: string, destination: string) => Promise<void>
}
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

it.skipIf(!hasDisplay)('verifies and provisions a physical pet ASAR while retaining normal application archive access', { retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bundled-asar-'))
  try {
    const resources = join(root, 'resources')
    const pet = join(resources, 'dsh-pet')
    const source = join(root, 'archive-source')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'marker.txt'), 'archive contents')
    await mkdir(join(pet, 'electron/resources'), { recursive: true })
    await createPackage(source, join(pet, 'electron/resources/default_app.asar'))
    await mkdir(join(pet, 'package'), { recursive: true })
    const archive = 'offline archive'
    const contents = JSON.stringify({ name: 'dsh-pet', version: '0.3.8-offline.1' })
    await writeFile(join(pet, 'plugin.tgz'), archive)
    await writeFile(join(pet, 'package/package.json'), contents)
    await writeFile(join(pet, 'electron/electron.exe'), 'runtime executable')
    const { readFile } = await import('node:fs/promises')
    const hash = (body: string | Buffer): string => createHash('sha256').update(body).digest('hex')
    const electronFiles = await Promise.all(['electron.exe', 'resources/default_app.asar'].map(async path => ({
      path, sha256: hash(await readFile(join(pet, 'electron', path))),
    })))
    await writeFile(join(resources, 'plugins.json'), JSON.stringify({ schemaVersion: 1, plugins: [{
      name: 'dsh-pet', version: '0.3.8-offline.1', sha256: hash(archive),
      files: [{ path: 'package.json', sha256: hash(contents) }], electronFiles,
    }] }))
    const module = fileURLToPath(new URL('../lib/types/bundled-plugins.js', import.meta.url))
    const fixture = fileURLToPath(new URL('./fixtures/bundled-plugins-asar.cjs', import.meta.url))
    const electron: unknown = require('electron')
    if (typeof electron !== 'string') throw new Error('Electron executable is unavailable')
    const result = await execa(electron, [fixture, module, root], {
      env: { ELECTRON_RUN_AS_NODE: undefined }, timeout: 30_000, forceKillAfterDelay: 5_000, reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('BUNDLED_PLUGINS_ASAR_OK')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
