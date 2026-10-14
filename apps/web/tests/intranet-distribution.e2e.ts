/** Keyless GUI evidence for the shipped intranet composition and its internal model default. */
import { chromium, type Browser, type Page } from 'playwright'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/intranet-distribution/', import.meta.url))

describe('web e2e: intranet distribution', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ distributionMode: 'intranet' })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'intranet-workspace')
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() }
    finally { await scaffold?.close() }
  })

  it('opens a workspace with the Hezhi default and no official onboarding', async () => {
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'hezhi', model: 'Qwen3.6-27B' })
    expect(scaffold.ctx.llm.listProviders()).toEqual([{ id: 'hezhi', name: '核智' }, { id: 'dizhi', name: '地质科技' }])
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect(await page.locator('[data-composer-input]').first().getAttribute('contenteditable')).toBe('true')
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Models', exact: true }).click()
    await settings.getByText('Intranet mode: official account and public companion services are disabled. Existing settings are retained.', { exact: true }).waitFor()
    expect(await settings.getByText('DeepSeek Account', { exact: true }).count()).toBe(0)
    await settings.getByText('核智', { exact: true }).first().waitFor()
    await settings.getByText('地质科技', { exact: true }).first().waitFor()
    await compareOrRefreshGolden(join(EXPECTED, 'models.expected.md'),
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
    expect(tripwire.pageErrors).toEqual([])
  })
})
