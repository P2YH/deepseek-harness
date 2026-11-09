/** Windows Host ownership established before application code can create descendants. */
import {
  closeHandleChecked, createKillOnCloseJob, extendWin32ProcessBindings, isJobEmpty, isNullPtr, terminateJob, throwLastError,
  type NativePtr,
} from '@deepseek-ai/dsh-win32-process'

/** Node preload barrier: the parent assigns the Job before releasing application imports. */
export const DESKTOP_HOST_JOB_PRELOAD = `data:text/javascript,${encodeURIComponent(`
await new Promise((resolve) => {
  const disconnected = () => process.exit(1)
  process.once('disconnect', disconnected)
  process.once('message', message => {
    if (message?.type !== 'desktop-host-job-start') process.exit(1)
    process.removeListener('disconnect', disconnected)
    resolve()
  })
  process.send({ type: 'desktop-host-job-ready' })
})
`)}`

/** The Electron main process retains the sole Job handle, including after Host exit. */
export class DesktopHostJob {
  private readonly api = extendWin32ProcessBindings(({ kernel32, bind }) => ({
    openProcess: bind(kernel32, 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']) as
      (access: number, inherit: number, pid: number) => NativePtr,
  }))
  private handle: NativePtr | undefined = createKillOnCloseJob(this.api)

  /**
   * Assign a child paused at the preload barrier.
   * @param pid - Direct Host process id received from Node's spawn.
   */
  assign(pid: number): void {
    if (this.handle === undefined) throw new Error('desktop Host Job is closed')
    // AssignProcessToJobObject requires PROCESS_SET_QUOTA and PROCESS_TERMINATE.
    const processHandle = this.api.openProcess(0x100 | 0x1, 0, pid)
    if (isNullPtr(processHandle)) throwLastError(this.api, 'OpenProcess', `desktop Host ${String(pid)}`)
    try {
      if (this.api.assignProcessToJobObject(this.handle, processHandle) === 0) throwLastError(this.api, 'AssignProcessToJobObject')
    } finally { closeHandleChecked(this.api, processHandle, 'desktop Host assignment') }
  }

  /** Terminate every member, including detached descendants of an exited Host. */
  terminate(): void {
    if (this.handle !== undefined) terminateJob(this.api, this.handle, 1)
  }

  /** Whether the Host and every descendant have exited. */
  get empty(): boolean { return this.handle === undefined || isJobEmpty(this.api, this.handle) }

  /** Wait at most one second for Job termination to reach every member. */
  async waitForExit(): Promise<void> {
    const deadline = Date.now() + 1_000
    while (!this.empty) {
      if (Date.now() >= deadline) throw new Error('desktop Host Job still contains processes after termination')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  /** Release ownership; Windows terminates remaining members even if explicit termination failed. */
  close(): void {
    const handle = this.handle
    if (handle === undefined) return
    this.handle = undefined
    closeHandleChecked(this.api, handle, 'desktop Host Job')
  }
}
