/** Keyless GUI evidence for the shipped intranet composition and its internal model default. */
import { chromium, type Browser, type Page } from 'playwright'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/intranet-distribution/', import.meta.url))

describe('web e2e: intranet distribution', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    vi.stubEnv('DIZHI_API_KEY', 'local-test-only')
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
    finally { try { await scaffold?.close() } finally { vi.unstubAllEnvs() } }
  })

  it('opens a workspace with the intranet default and no official onboarding', async () => {
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'dizhi', model: 'gen-studio-Qwen3.6-27B-ygNP' })
    expect(scaffold.ctx.llm.listProviders()).toEqual([{ id: 'hezhi-dsv4', name: '核智 DeepSeek' }, { id: 'dizhi', name: '地质科技' }])
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect(await page.locator('[data-composer-input]').first().getAttribute('contenteditable')).toBe('true')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Models', exact: true }).click()
    await settings.getByText('Intranet mode: official account and public companion services are disabled. Existing settings are retained.', { exact: true }).waitFor()
    expect(await settings.getByText('DeepSeek Account', { exact: true }).count()).toBe(0)
    await settings.getByText('核智 DeepSeek', { exact: true }).first().waitFor()
    await settings.getByText('地质科技', { exact: true }).first().waitFor()
    await compareOrRefreshGolden(join(EXPECTED, 'models.expected.md'),
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    const selector = page.getByRole('button', { name: /^Select model/ })
    await expect.poll(() => selector.getAttribute('aria-label')).toBe('Select model, current 地质科技 Qwen3.6-27B, reasoning effort Off')
    await selector.click()
    await page.getByRole('menuitem', { name: /Effort/ }).click()
    await expect.poll(() => page.getByRole('menuitemradio').allTextContents()).toEqual(['Off', 'High'])
    expect(await page.getByRole('menuitemradio', { name: 'Off', exact: true }).getAttribute('aria-checked')).toBe('true')
    await compareOrRefreshGolden(join(EXPECTED, 'qwen-reasoning.expected.md'),
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), webSnapshotMode())
    expect(tripwire.pageErrors).toEqual([])
  })
})
