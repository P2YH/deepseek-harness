/** Resolve the explicit private model-key input for an intranet Desktop package. */
import { readFileSync } from 'node:fs'
import { resolveDesktopDistributionMode } from './desktop-distribution-mode.mjs'

/**
 * Validate an opt-in deployment file without including its contents in diagnostics.
 * @param {NodeJS.ProcessEnv} environment File-owned packaging settings.
 * @returns {string | undefined} Validated file path, absent for packages without deployment keys.
 */
export function resolveIntranetModelKeysFile(environment) {
  const path = environment.DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE
  if (path === undefined || path === '') return undefined
  if (resolveDesktopDistributionMode(environment) !== 'intranet') {
    throw new Error('desktop package: model deployment keys require intranet mode')
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    const refs = value?.refs
    if (value?.version !== 1 || Object.keys(value).length !== 2 || refs === null || typeof refs !== 'object' || Array.isArray(refs)
      || Object.keys(refs).length !== 2
      || ['DIZHI_API_KEY', 'HEZHI_API_KEY'].some(ref => typeof refs[ref] !== 'string'
        || !/^[A-Za-z0-9._~+/-]+=*$/u.test(refs[ref]))) throw Error()
  } catch {
    throw new Error('desktop package: invalid intranet model deployment file')
  }
  return path
}
