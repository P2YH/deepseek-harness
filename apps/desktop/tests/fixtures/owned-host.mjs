/** Isolated Host with an internal detached worker and a shell-owned external application. */
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const internal = join(process.argv[3], 'internal.pid')
const external = join(process.argv[3], 'external.pid')
const worker = 'setInterval(() => {}, 1000); require("node:fs").writeFileSync(process.argv[1], String(process.pid))'
const child = spawn(process.execPath, ['-e', worker, internal], { detached: true, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
child.unref()
let externalAccepted = false
process.on('message', message => {
  if (message.type === 'desktop-external-result') {
    if (message.error) throw new Error(message.error)
    externalAccepted = true
  }
  if (message.type === 'shutdown') process.send({ type: 'shutdown-complete' }, () => process.exit(0))
})
process.send({ type: 'desktop-external-action', requestId: 'external-fixture', action: {
  kind: 'launch', command: process.execPath, args: ['-e', worker, external],
  options: { env: process.env, watchMs: 50, windowsHide: true },
} })
const readiness = setInterval(() => {
  if (!externalAccepted || !existsSync(internal) || !existsSync(external)) return
  clearInterval(readiness)
  process.send({ type: 'ready', url: 'http://127.0.0.1:1/' })
}, 10)
