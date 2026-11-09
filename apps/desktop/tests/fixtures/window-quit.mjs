/** Real Chromium unload vetoes and process-lifetime instance ownership with a private profile. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { closeDesktopWindowForQuit } from '../../lib/types/quit-window.js'
import { DesktopHostProcess, DesktopHostUncleanExitError } from '../../lib/types/host-process.js'

const [root, phase] = process.argv.slice(2)
assert.ok(root)
app.setPath('userData', join(root, 'electron'))
assert.equal(app.requestSingleInstanceLock(), true, 'previous application retained the instance lock')
app.on('window-all-closed', () => {})
const fail = error => { console.error(error); app.exit(1) }
process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function waitForExit(pid) {
  const deadline = Date.now() + 2_000
  while (alive(pid)) {
    assert.ok(Date.now() < deadline, `private fixture ${pid} did not exit`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function checkHostProcesses(mode) {
  const project = join(root, mode)
  const entry = join(project, 'node_modules/@deepseek-ai/dsh-desktop-host')
  await mkdir(join(entry, 'lib'), { recursive: true })
  await writeFile(join(entry, 'package.json'), '{"type":"module"}')
  await writeFile(join(entry, 'lib/index.js'), await readFile(new URL('./owned-host.mjs', import.meta.url)))
  const host = new DesktopHostProcess(process.execPath, project, project)
  let external
  try {
    await host.start()
    const internal = Number(await readFile(join(project, 'internal.pid'), 'utf8'))
    external = Number(await readFile(join(project, 'external.pid'), 'utf8'))
    assert.equal(alive(internal), true)
    assert.equal(alive(external), true)
    let updateRefused = false
    if (mode === 'forced') { host.forceStop(); await host.stop() }
    else if (mode === 'update') {
      const error = await host.stop(true).catch(error => error)
      updateRefused = error instanceof DesktopHostUncleanExitError
    } else await host.stop()
    const expected = JSON.parse(await readFile(new URL('../expected/quit-processes.json', import.meta.url), 'utf8'))
    assert.deepEqual({ internalAlive: alive(internal), externalAlive: alive(external), updateRefused }, expected[mode])
  } finally {
    await host.stop()
    if (external === undefined) {
      try { external = Number(await readFile(join(project, 'external.pid'), 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    if (external !== undefined && alive(external)) { process.kill(external, 'SIGKILL'); await waitForExit(external) }
  }
}

async function run() {
  await app.whenReady()
  const cases = []
  if (phase === 'first') {
    for (const [embedded, outcome] of [false, true].flatMap(embedded => ['cancel', 'failure', 'discard'].map(outcome => [embedded, outcome]))) {
      const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
      const document = '<button style="position:fixed;inset:0" onclick="window.armed=true;window.onbeforeunload=()=>false">Edit</button>'
      const html = embedded ? `<iframe style="position:fixed;inset:0;border:0" srcdoc="${document.replaceAll('"', '&quot;')}"></iframe>` : document
      await window.loadURL(`data:text/html,${encodeURIComponent(html)}`)
      window.webContents.debugger.attach('1.3')
      for (const type of ['mousePressed', 'mouseReleased']) {
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type, x: 30, y: 30, button: 'left', clickCount: 1,
        })
      }
      assert.equal(await window.webContents.executeJavaScript(embedded ? 'frames[0].armed' : 'window.armed'), true)
      window.webContents.debugger.detach()
      let confirmations = 0
      const closing = closeDesktopWindowForQuit(window, async () => {
        confirmations++
        if (outcome === 'failure') throw new Error('dialog unavailable')
        return outcome === 'discard'
      })
      if (outcome === 'failure') await assert.rejects(closing, /dialog unavailable/)
      else assert.equal(await closing, outcome === 'discard')
      assert.equal(confirmations, 1, 'Chromium did not report the document unload veto')
      assert.equal(window.isDestroyed(), outcome === 'discard')
      if (outcome !== 'discard') {
        assert.equal(window.webContents.listenerCount('will-prevent-unload'), 0)
        assert.equal(await window.webContents.executeJavaScript('document.readyState'), 'complete')
        window.destroy()
      }
      cases.push(`${embedded ? 'iframe' : 'main-document'}-${outcome}`)
    }
    const clean = new BrowserWindow({ show: false })
    await clean.loadURL('data:text/html,clean')
    assert.equal(await closeDesktopWindowForQuit(clean, async () => { throw new Error('clean document asked to discard') }), true)
    cases.push('clean-document-closes-without-confirmation')
    if (process.platform === 'win32') for (const mode of ['ordinary', 'forced', 'update']) {
      await checkHostProcesses(mode)
      cases.push(`owned-processes-${mode}`)
    }
  } else {
    assert.equal(phase, 'restart')
    cases.push('restart-acquired-instance-lock')
  }
  await writeFile(join(root, `${phase}.json`), JSON.stringify({ electron: process.versions.electron, cases }, null, 2) + '\n')
  app.quit()
}

void run().catch(fail)
