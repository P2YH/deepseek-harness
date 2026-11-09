/** Check Chromium document unload decisions and relaunch against a built Desktop helper. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const repo = resolve(import.meta.dirname, '../../..')
const { values } = parseArgs({ options: { electron: { type: 'string' } } })
const electron = values.electron ?? join(repo, 'apps/desktop/.desktop-build/targets/win-x64/electron/electron.exe')
const evidence = join(repo, 'apps/desktop/.desktop-build/qualification')
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(evidence, 'window-quit-'))
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(?:path|systemroot|windir|comspec|pathext)$/iu.test(name)))
for (const phase of ['first', 'restart']) {
  const child = spawn(electron, [fileURLToPath(new URL('../tests/fixtures/window-quit.mjs', import.meta.url)), root, phase], {
    cwd: root, env: { ...environment, USERPROFILE: root, HOME: root, TEMP: root, TMP: root },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let diagnostic = ''
  child.stdout.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-4000) })
  child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-4000) })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    if (process.platform === 'win32' && child.pid !== undefined) {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) }
      catch (error) { diagnostic += String(error); child.kill('SIGKILL') }
    } else child.kill('SIGKILL')
  }, 20_000)
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject)
      child.once('close', done)
    })
    if (timedOut || code !== 0) throw new Error(`Window quit ${phase} failed: timeout=${String(timedOut)}, exit=${String(code)}; ${diagnostic}; evidence=${root}`)
    console.log((await readFile(join(root, `${phase}.json`), 'utf8')).trim())
  } finally { clearTimeout(timer) }
}
console.log(`Window quit evidence: ${root}`)
