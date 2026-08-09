import { expect, test } from '@playwright/test'

import { newAccount, register, signIn } from './helpers'

/**
 * Authentication and route protection. (CLAUDE.md §25, §75)
 *
 * The guard behaviour is the part worth testing in a browser: whether a deep
 * link survives a sign-in is a question about history state and render order
 * that a unit test cannot answer.
 */

test('registers, signs out and signs back in', async ({ page }) => {
  const account = newAccount()
  await register(page, account)

  await page.getByRole('button', { name: /Account|Profile|Open user menu/i }).first().click()
  await page.getByRole('menuitem', { name: /Sign out|Log out/i }).click()
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })

  await signIn(page, account)
  await expect(page).toHaveURL(/\/app\/dashboard/)
})

test('rejects a wrong password without leaving the form', async ({ browser, page }) => {
  const account = newAccount()
  await register(page, account)

  /* A second context, signed out. `/login` is a guest-only route: visiting it
     with a live session redirects to the dashboard, so the form under test
     would never render. */
  const visitor = await browser.newContext()
  const loginPage = await visitor.newPage()
  await loginPage.goto('/login')

  await loginPage.getByLabel(/^Email/).fill(account.email)
  await loginPage.getByLabel(/^Password/).first().fill('Not-The-Password-9')
  await loginPage.getByRole('button', { name: 'Sign in' }).click()

  /* Readable, and it does not say which of the two was wrong — telling an
     attacker that an address exists is a free account enumeration. The message
     comes from Django's error envelope, so this also covers the client parsing
     it rather than falling back to a generic status string. */
  await expect(loginPage.getByRole('alert')).toContainText(/email or password/i, {
    timeout: 20_000,
  })
  await expect(loginPage).toHaveURL(/\/login/)

  await visitor.close()
})

test('sends an anonymous visitor to the login screen', async ({ page }) => {
  await page.goto('/app/dashboard')

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
})
