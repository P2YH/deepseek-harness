/** Resolve file-owned packaging mode before workspace libraries are built. @param environment - Release settings. @returns Validated distribution mode. */
export function resolveDesktopDistributionMode(environment: NodeJS.ProcessEnv): 'standard' | 'intranet'
