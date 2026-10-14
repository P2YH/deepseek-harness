/** Launcher-owned intranet capabilities, applied above profile edits and preset configurations. */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { distributionModeOf, resolveDistributionMode, type DistributionMode } from '@deepseek-ai/dsh-launch-environment'

const DISABLED_MODULES = new Set([
  '@deepseek-ai/dsh-deepseek-account-platform',
  '@deepseek-ai/dsh-llm-deepseek-account',
  '@deepseek-ai/dsh-llm-deepseek-api-key',
  '@deepseek-ai/dsh-api-account-controller',
  '@deepseek-ai/dsh-client-ui-settings-account',
  '@deepseek-ai/dsh-client-product-analytics',
  '@deepseek-ai/dsh-host-product-telemetry-otel',
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-session-log-deepseek',
  '@deepseek-ai/dsh-client-ui-settings-session-log',
  '@deepseek-ai/dsh-client-ui-message-feedback',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-client-ui-settings-web-search',
])
const OFFICIAL_PROVIDERS = new Set(['deepseek-official', 'deepseek-account'])

/** A built-in package subpath carries the same capabilities as its root entry. */
function packageName(name: string): string {
  return name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')
}

/**
 * Select a product mode only for the Web bundle and Desktop carrier.
 * @param profile - requested profile name.
 * @param bundles - resolved bundle package names.
 * @param value - launcher's inherited distribution setting.
 * @returns standard for non-GUI profiles, otherwise the validated selection.
 */
export function resolveProfileDistributionMode(
  profile: string, bundles: readonly string[], value: string | undefined,
): DistributionMode {
  if (profile !== 'desktop' && profile !== 'web' && !bundles.includes('@deepseek-ai/dsh-web-app')) return 'standard'
  return resolveDistributionMode(value)
}

function enforceConfig(name: string, config: unknown): unknown {
  name = packageName(name)
  if (name !== '@deepseek-ai/dsh-llm' && name !== '@deepseek-ai/dsh-agent-default-model') return config
  if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) return config
  const fields = (config ?? {}) as Record<string, unknown>
  if (name === '@deepseek-ai/dsh-llm') return { ...fields, requireAvailableModel: true }
  if (typeof fields.provider === 'string' && OFFICIAL_PROVIDERS.has(fields.provider)) return {}
  return config
}

/**
 * Preserve user layers while deriving the entries an intranet product can activate.
 * @param entries - fully composed entries, including nested groups.
 * @param mode - fixed launcher mode.
 * @returns detached intranet entries, or the unchanged standard entry list.
 */
export function applyDistributionEntries(entries: EntryOptions[], mode: DistributionMode): EntryOptions[] {
  if (mode === 'standard') return entries
  return structuredClone(entries).map((entry) => {
    if (DISABLED_MODULES.has(packageName(entry.name))) entry.disabled = true
    if (entry.group && Array.isArray(entry.config)) {
      entry.config = applyDistributionEntries(entry.config as EntryOptions[], mode)
    } else {
      entry.config = enforceConfig(entry.name, entry.config)
    }
    return entry
  })
}

/**
 * Enforce launcher capabilities during subsequent Loader activation and configuration changes.
 * @param ctx - boot context prepared before the root Include mounts.
 */
export function installDistributionPolicy(ctx: Context): void {
  if (distributionModeOf(ctx) !== 'intranet') return
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const config: unknown = next()
    const entry = this.entry
    if (entry === undefined) return config
    if (DISABLED_MODULES.has(packageName(entry.options.name))) {
      throw new Error(`Intranet distribution disables ${entry.options.name}; the stored configuration is preserved`)
    }
    if (entry.options.group && Array.isArray(config)) return applyDistributionEntries(config as EntryOptions[], 'intranet')
    return enforceConfig(entry.options.name, config)
  }, { global: true, prepend: true })
}
