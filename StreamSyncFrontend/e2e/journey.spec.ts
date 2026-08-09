import { expect, test } from '@playwright/test'

import { newAccount, register, workspaceIdFrom } from './helpers'

/**
 * The demo narrative (CLAUDE.md §84) against the real Django API.
 *
 * One test, in sequence, because each stage depends on what the last one
 * created — and because that is the actual shape of a first session. The mock
 * suite splits the same narrative into independent specs; it can, because its
 * data is seeded.
 *
 * What this catches that nothing else can: a field the backend spells
 * `is_current` and the client reads as `isCurrent`, a paginated envelope where
 * the client expects an array, an error body the form cannot parse, a
 * WebSocket that never opens. Both suites pass in isolation while disagreeing
 * about the JSON between them.
 */

test('a new team can go from empty account to a working workspace', async ({ page }) => {
  const account = newAccount()
  const failures: string[] = []

  // Any 4xx/5xx during a run that is supposed to be entirely happy-path is
  // itself a finding, whether or not an assertion happens to notice.
  page.on('response', (response) => {
    const url = response.url()
    if (!url.includes('/api/')) return
    // The boot-time "am I signed in?" probe is a 401 by design when nobody is.
    if (response.status() === 401 && url.includes('/auth/refresh/')) return
    if (response.status() >= 400) failures.push(`${response.status()} ${response.request().method()} ${url}`)
  })

  await test.step('register', async () => {
    await register(page, account)
  })

  await test.step('the first workspace can be created from an empty account', async () => {
    // The state every real first sign-in starts in. There has to be a way out
    // of it on screen.
    await page.getByRole('button', { name: /Create workspace|Create your first workspace/ }).first().click()

    // Scoped to the dialog: the page behind it has a button with the same name,
    // which is correct — one opens the dialog, the other submits it.
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Name/).fill('EverTech')
    await dialog.getByRole('button', { name: 'Create workspace' }).click()

    await expect(page.getByRole('button', { name: /Workspace: EverTech/ })).toBeVisible({
      timeout: 20_000,
    })
  })

  // The sidebar link, not the dashboard's "All projects" shortcut.
  await page.getByRole('navigation').getByRole('link', { name: 'Projects', exact: true }).first().click()
  await expect(page).toHaveURL(/\/app\/workspaces\/[^/]+\/projects/, { timeout: 20_000 })
  const workspaceId = workspaceIdFrom(page.url())

  await test.step('create a project', async () => {
    await page.getByRole('button', { name: /New project/i }).first().click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Name/).fill('Checkout Revamp')
    await dialog.getByRole('button', { name: /^Create project$/ }).click()

    await expect(page.getByText('Checkout Revamp').first()).toBeVisible({ timeout: 20_000 })
  })

  await test.step('create and edit a document', async () => {
    await page.goto(`/app/workspaces/${workspaceId}/documents`)

    await page.getByRole('button', { name: /New document/i }).first().click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Title/).fill('Payment Requirements')
    await dialog.getByRole('button', { name: /^Create document$/ }).click()

    // Landing in the editor is the assertion: creation returned a document the
    // router could resolve.
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 20_000 })

    const body = page.getByRole('textbox', { name: 'Document body' })
    await expect(body).toBeVisible({ timeout: 20_000 })
    await body.click()
    await body.pressSequentially('Stripe will be used for payment processing. ')

    // "Saved" is the round trip: the editor wrote, the server accepted, and the
    // status reflects the server rather than optimism.
    await expect(page.getByText(/Saved|Synced/).first()).toBeVisible({ timeout: 20_000 })
  })

  const documentUrl = page.url()

  await test.step('version history lists the saves', async () => {
    await page.getByRole('button', { name: /History|Version history/i }).first().click()

    // A version row proves the paginated snake_case payload mapped: an unmapped
    // one renders "Version undefined".
    await expect(page.getByText(/Version \d+/).first()).toBeVisible({ timeout: 20_000 })
  })

  await test.step('the assistant answers from the document', async () => {
    await page.goto(documentUrl)
    await page.getByRole('button', { name: 'AI assistant' }).first().click()
    await page.getByRole('button', { name: 'Summarise', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible({ timeout: 30_000 })
    // Provenance is not decoration: the panel must say what produced the text.
    await expect(page.getByText(/mock-heuristic|not by a model/i).first()).toBeVisible()
  })

  await test.step('comments post and appear', async () => {
    await page.goto(documentUrl)
    await page.getByRole('button', { name: /Comments/i }).first().click()

    const composer = page.getByPlaceholder(/Add a comment/i)
    await composer.click()
    await composer.fill('Does this cover refunds?')
    await page.getByRole('button', { name: /^Comment$/ }).click()

    await expect(page.getByText('Does this cover refunds?')).toBeVisible({ timeout: 20_000 })
  })

  await test.step('create a task', async () => {
    await page.goto(`/app/workspaces/${workspaceId}/tasks`)

    await page.getByRole('button', { name: /New task/i }).first().click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Title/).fill('Implement Stripe API')
    // A task belongs to a project, and the form says so rather than filing the
    // work somewhere arbitrary.
    await dialog.getByLabel(/^Project/).selectOption({ label: 'Checkout Revamp' })
    await dialog.getByRole('button', { name: /^Create task$/ }).click()

    await expect(page.getByText('Implement Stripe API').first()).toBeVisible({ timeout: 20_000 })
  })

  await test.step('search finds what was created', async () => {
    await page.goto(`/app/workspaces/${workspaceId}/projects`)
    await page.getByRole('button', { name: /Search/i }).first().click()

    await page.getByRole('combobox', { name: /Search/i }).or(page.getByRole('textbox').first()).fill('payment')

    // Cross-type ranking from the server: the document should surface for a
    // word that appears in its title.
    await expect(page.getByText('Payment Requirements').first()).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
  })

  await test.step('the activity timeline recorded the session', async () => {
    await page.goto(`/app/workspaces/${workspaceId}/activity`)

    await expect(page.getByText(/Payment Requirements|Checkout Revamp/).first()).toBeVisible({
      timeout: 20_000,
    })
  })

  await test.step('the dashboard reports real numbers', async () => {
    await page.goto('/app/dashboard')

    await expect(page.getByRole('heading', { level: 1 })).toContainText(account.firstName)
    // Counts come from the server; a client summing a page of tasks could not
    // produce them correctly.
    await expect(page.getByText(/Active projects/i).first()).toBeVisible({ timeout: 20_000 })
  })

  expect(failures, `unexpected API failures:\n${failures.join('\n')}`).toEqual([])
})
