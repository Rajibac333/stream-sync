import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared steps for the end-to-end suite.
 *
 * Every spec runs against the real Django API — there is no mock data set to
 * sign into any more, so each one builds the state it needs. That is slower
 * than seeded fixtures and worth it: the setup path *is* the product's first-run
 * experience, and a bug in it used to be invisible.
 *
 * Queries go by role and accessible name. A selector only a test can see passes
 * just as happily when the control has no accessible name, which is precisely
 * the defect worth catching.
 */

/**
 * A fresh account per run, so a database with history in it stays usable.
 *
 * `label` distinguishes the people in a multi-user spec. Two accounts sharing a
 * first name make a presence assertion meaningless — "is the other person
 * here?" passes on your own name.
 */
export function newAccount(label = 'Live') {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return {
    name: `${label} Tester ${suffix}`,
    firstName: label,
    email: `${label.toLowerCase()}-${suffix}@streamsync.test`,
    /* Satisfies both ends of the contract, which differ: the register form
       wants upper and lower case plus a digit, and Django additionally rejects
       anything under ten characters, numeric-only, or on the common-password
       list. A password that passes one and fails the other is exactly the kind
       of mismatch this suite exists to catch. */
    password: 'Correct-Horse-Battery-42',
  }
}

export type Account = ReturnType<typeof newAccount>

/** Registers through the UI and waits for the dashboard to render. */
export async function register(page: Page, account: Account): Promise<void> {
  await page.goto('/register')

  await page.getByLabel(/Full name/i).fill(account.name)
  await page.getByLabel(/Work email/i).fill(account.email)
  await page.getByLabel(/^Password/).first().fill(account.password)

  const confirm = page.getByLabel(/Confirm password/i)
  if (await confirm.count()) await confirm.fill(account.password)

  await page.getByRole('button', { name: /Create account|Sign up|Register/i }).click()

  // The greeting proves the session resolved and the user payload mapped —
  // a URL change alone would pass with an empty user object.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(account.firstName, {
    timeout: 20_000,
  })
}

/** Signs an existing account in. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login')

  await page.getByLabel(/^Email/).fill(account.email)
  await page.getByLabel(/^Password/).first().fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 })
}

/**
 * The navigation surface, opened if it is a drawer.
 *
 * Below `md` the sidebar is replaced by a drawer, so its links are not on
 * screen until it is opened — and while it is open *both* exist in the DOM,
 * the drawer's and the hidden sidebar's. Returning the right scope is what
 * keeps a click from waiting forever on the copy that is not visible.
 */
export async function navigationScope(page: Page): Promise<Locator> {
  const opener = page.getByRole('button', { name: 'Open navigation' })

  if (await opener.isVisible().catch(() => false)) {
    await opener.click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect(drawer).toBeVisible()
    return drawer
  }

  return page.getByRole('navigation').first()
}

/** Creates the first workspace from the empty state. */
export async function createWorkspace(page: Page, name: string): Promise<string> {
  /* Two controls carry this name — the sidebar switcher and the dashboard's
     empty state — and on a phone the sidebar one is inside a closed drawer.
     Filtering to what is actually on screen is the difference between clicking
     the button a person would and waiting forever on a hidden one. */
  await page
    .getByRole('button', { name: /Create workspace|Create your first workspace/ })
    .filter({ visible: true })
    .first()
    .click()

  // Scoped to the dialog: the page behind it has a button with the same name,
  // which is correct — one opens the dialog, the other submits it.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByRole('button', { name: 'Create workspace' }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })

  /* Creating a workspace navigates into it — the client does this itself, and
     waiting for the URL is both the assertion that it happened and how the id
     is obtained. Clicking a nav link here instead used to fight the drawer's
     open animation for a link the page was already on. */
  await page.waitForURL(/\/app\/workspaces\/[^/]+/, { timeout: 20_000 })

  return workspaceIdFrom(page.url())
}

/** An account with one workspace — the starting point for most specs. */
export async function registerWithWorkspace(
  page: Page,
  workspaceName = 'EverTech',
): Promise<{ account: Account; workspaceId: string }> {
  const account = newAccount()
  await register(page, account)
  const workspaceId = await createWorkspace(page, workspaceName)
  return { account, workspaceId }
}

/** The workspace id from the current URL. */
export function workspaceIdFrom(url: string): string {
  const match = /\/workspaces\/([^/]+)/.exec(url)
  if (!match) throw new Error(`No workspace id in ${url}`)
  return match[1]
}

/** Opens a workspace-scoped screen directly. */
export async function goToWorkspace(
  page: Page,
  workspaceId: string,
  section: string,
): Promise<void> {
  await page.goto(`/app/workspaces/${workspaceId}/${section}`)
}
