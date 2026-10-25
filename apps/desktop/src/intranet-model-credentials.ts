/** Deployment-owned intranet keys provisioned below user-managed credentials. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const REFERENCES = ['DIZHI_API_KEY', 'HEZHI_API_KEY'] as const

/**
 * Fill missing home dotenv keys from an explicitly bundled deployment file.
 * Managed credentials and inherited environment retain their existing precedence.
 * The caller selects the file only for a packaged intranet application.
 * @param home - Harness home shared by Desktop and its Host.
 * @param seedPath - Private deployment JSON containing only the two model keys.
 * @returns After the locked, atomic dotenv write; repeated calls preserve existing values.
 */
export async function seedIntranetModelCredentials(home: string, seedPath: string): Promise<void> {
  let refs: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(await readFile(seedPath, 'utf8'))
    if (typeof value !== 'object' || value === null || Object.keys(value).length !== 2 || !('version' in value) || value.version !== 1
      || !('refs' in value) || typeof value.refs !== 'object' || value.refs === null || Array.isArray(value.refs)) throw Error()
    refs = value.refs as Record<string, unknown>
    if (Object.keys(refs).length !== REFERENCES.length || REFERENCES.some(ref => typeof refs[ref] !== 'string'
      || !/^[A-Za-z0-9._~+/-]+=*$/u.test(refs[ref]))) throw Error()
  } catch {
    // JSON parser errors can contain the credential-bearing source line.
    throw new Error('desktop intranet credentials: invalid deployment file')
  }
  await mkdir(home, { recursive: true, mode: 0o700 })
  const path = join(home, '.env')
  await withFileLock(path, async () => {
    let previous = ''
    try { previous = await readFile(path, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    let current: NodeJS.Dict<string>
    try { current = parseEnv(previous.replace(/^\uFEFF/u, '')) }
    catch { throw new Error('desktop intranet credentials: invalid home dotenv') }
    const missing = REFERENCES.filter(ref => !current[ref])
    if (missing.length === 0) return
    const separator = previous.length > 0 && !previous.endsWith('\n') ? '\n' : ''
    const additions = missing.map(ref => `${ref}=${String(refs[ref])}\n`).join('')
    await writeFileAtomic(path, previous + separator + additions, { mode: 0o600, dirMode: 0o700 })
  })
}
