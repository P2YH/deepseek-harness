import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveIntranetModelKeysFile } from '../scripts/intranet-model-keys.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { loadDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-key-package-'))
  roots.push(root)
  const path = join(root, 'keys.json')
  writeFileSync(path, JSON.stringify({ version: 1, refs: { DIZHI_API_KEY: 'test-dizhi', HEZHI_API_KEY: 'test-hezhi' } }))
  return { root, path, env: { DSH_DESKTOP_APP_ID: 'com.example.intranet', DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE: path } }
}

it('includes only an explicitly selected deployment file and declares startup provisioning', () => {
  const { env, path } = setup()
  const config = createElectronBuilderConfig({ ...env, DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
  expect(config.extraMetadata.dshIntranetModelCredentials).toBe(true)
  expect(config.extraResources).toContainEqual({ from: path, to: 'intranet-model-credentials.json' })
  expect(JSON.stringify(config.extraMetadata)).not.toContain('test-dizhi')
  const plain = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.intranet', DSH_DISTRIBUTION_MODE: 'intranet', DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
  expect(plain.extraMetadata).not.toHaveProperty('dshIntranetModelCredentials')
})

it('does not inherit an ambient deployment file and resolves a file-owned relative path', () => {
  const { root, path } = setup()
  writeFileSync(join(root, '.env.windows'), 'DSH_DISTRIBUTION_MODE=intranet\n')
  expect(loadDesktopPackageEnvironment('win32', { DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE: path }, root))
    .not.toHaveProperty('DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE')
  writeFileSync(join(root, '.env.windows'), 'DSH_DISTRIBUTION_MODE=intranet\nDSH_DESKTOP_INTRANET_MODEL_KEYS_FILE=keys.json\n')
  expect(loadDesktopPackageEnvironment('win32', {}, root).DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE).toBe(path)
})

it('rejects standard-mode inclusion and invalid deployment files without disclosing values', () => {
  const { env, path } = setup()
  expect(() => resolveIntranetModelKeysFile({ ...env, DSH_DISTRIBUTION_MODE: 'standard' })).toThrow(/require intranet mode/u)
  for (const raw of ['{"test-secret":', JSON.stringify({ version: 1, refs: { DIZHI_API_KEY: 'test-secret' } }),
    JSON.stringify({ version: 1, refs: { DIZHI_API_KEY: 'test-secret', HEZHI_API_KEY: 'test', OTHER_KEY: 'test' } })]) {
    writeFileSync(path, raw)
    expect(() => resolveIntranetModelKeysFile(env)).toThrow(/^desktop package: invalid intranet model deployment file$/u)
  }
})
