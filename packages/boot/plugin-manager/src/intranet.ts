/** Intranet package operations use one explicit registry or local offline packages. */
import type { ParsedInstallSpec } from './install-spec.ts'
import type { Registry } from './types.ts'
import { ManagementFailure } from './failure.ts'
import { isPublicRegistry, normalizeRegistry } from './registry.ts'
import { parseInstallSpec } from './install-spec.ts'
import { resolve } from 'node:path'

const INSTALL_COMMANDS = new Set(['add', 'install', 'i'])
const MUTATING_COMMANDS = new Set([...INSTALL_COMMANDS, 'remove', 'rm', 'uninstall'])
const READ_COMMANDS = new Set(['list', 'ls'])
const OPTIONS = new Set(['--offline', '--ignore-scripts', '--frozen-lockfile', '--lockfile-only', '--prod', '--dev',
  '--save-dev', '--save-prod', '--save-exact', '--no-optional', '-D', '-P', '-E', '--json', '--parseable', '--long'])

function isRemoteSpec(spec: ParsedInstallSpec): boolean {
  return spec.kind === 'git' || (spec.kind === 'tarball' && spec.path === undefined)
    || (spec.kind === 'registry' && spec.range !== undefined && /[:/\\#@]/.test(spec.range))
}

/** Restrict built-in intranet package commands before pnpm or profile initialization can run.
 * @param input Original pnpm arguments.
 * @param cwd Invocation directory used to validate local paths.
 * @returns Arguments restricted to an explicit registry or offline package mutations.
 * @throws When the command, option, or source cannot obey the intranet source policy.
 */
export function intranetPnpmArguments(input: readonly string[], cwd: string): string[] {
  const command = input[0] === undefined || input[0].startsWith('-') ? 'install' : input[0]
  if (!MUTATING_COMMANDS.has(command) && !READ_COMMANDS.has(command)) {
    throw new Error(`Intranet plugin management does not support pnpm ${command}; use add, install, remove, or list`)
  }
  const args = input[0] === command ? input.slice(1) : input
  const specs: string[] = []
  const flags: string[] = []
  let registry: Registry = null
  const iterator = args.values()
  for (const argument of iterator) {
    if (argument === '--registry' || argument.startsWith('--registry=')) {
      const url = argument === '--registry' ? iterator.next().value : argument.slice('--registry='.length)
      if (url === undefined || registry !== null) throw new Error('Intranet plugin management requires one explicit registry URL')
      registry = normalizeRegistry(url)
      if (isPublicRegistry(registry)) throw new Error('Intranet plugin management refuses public npm sources; use an intranet registry or local package')
    } else if (argument.startsWith('-')) {
      if (!OPTIONS.has(argument) && !/^--depth=\d+$/.test(argument)) {
        throw new Error(`Intranet plugin management does not support pnpm option ${argument}`)
      }
      flags.push(argument)
    } else {
      specs.push(argument)
    }
  }
  if (INSTALL_COMMANDS.has(command)) {
    for (const spec of specs) {
      const match = /^(file:|link:)?(\.{1,2}(?:[/\\].*)?)$/.exec(spec)
      const path = match?.[2]
      const anchored = path === undefined ? spec : `${match?.[1] ?? ''}${resolve(cwd, path)}`
      try { intranetRegistry(parseInstallSpec(anchored), registry, null) }
      catch {
        throw new Error(`Intranet plugin source ${JSON.stringify(spec)} is not allowed; use a local path or an explicit intranet --registry URL`)
      }
    }
  }
  if (MUTATING_COMMANDS.has(command) && registry === null && !flags.includes('--offline')) flags.push('--offline')
  return [command, ...specs, ...flags, ...registry === null ? [] : [`--registry=${registry}`]]
}

/** Refuse remote specs in an existing manifest before a default installation.
 * @param dependencies Direct dependency specs read from the profile manifest.
 * @param dir Profile directory used to resolve local dependency paths.
 * @throws When a dependency names Git, a remote archive, or an unsupported source alias.
 */
export function assertIntranetDependencies(dependencies: Readonly<Record<string, string>>, dir: string): void {
  for (const [name, value] of Object.entries(dependencies)) {
    const local = /^(file:|link:)(.*)$/.exec(value)
    const path = local?.[2]
    const spec = path === undefined ? `${name}@${value}` : `${local?.[1] ?? ''}${resolve(dir, path)}`
    if (isRemoteSpec(parseInstallSpec(spec))) {
      throw new Error(`Intranet plugin management refuses the remote source of ${name}; use a local package or intranet registry version`)
    }
  }
}

/** Resolve an allowed source before any inspection, build approval, or package mutation.
 * @param spec Parsed package source.
 * @param requested Caller-selected registry; undefined uses the configured registry.
 * @param configured Explicit registry configured on the manager, or null for local offline installation.
 * @returns The normalized registry, or null for a local offline package.
 * @throws ManagementFailure when the source does not obey intranet policy.
 */
export function intranetRegistry(spec: ParsedInstallSpec, requested: Registry | undefined, configured: Registry): Registry {
  const registry = requested === undefined ? configured : requested
  if (isRemoteSpec(spec)
    || (registry !== null && isPublicRegistry(registry)) || (spec.kind === 'registry' && registry === null)) {
    throw new ManagementFailure('intranet-source-required')
  }
  return registry === null ? null : normalizeRegistry(registry)
}
