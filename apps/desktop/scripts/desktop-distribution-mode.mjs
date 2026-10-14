/** Distribution selection for plain-Node packaging before workspace libraries are built. */

/**
 * Resolve the release file's distribution mode.
 * @param {NodeJS.ProcessEnv} environment File-owned release settings.
 * @returns {'standard' | 'intranet'} Validated distribution mode.
 */
export function resolveDesktopDistributionMode(environment) {
  const mode = environment.DSH_DISTRIBUTION_MODE
  if (mode === undefined || mode === 'standard') return 'standard'
  if (mode === 'intranet') return 'intranet'
  throw new Error('DSH_DISTRIBUTION_MODE must be standard or intranet')
}
