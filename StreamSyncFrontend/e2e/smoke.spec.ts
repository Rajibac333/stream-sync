import { expect, test } from '@playwright/test'

import { newAccount, register } from './helpers'

/**
 * Exploratory: what a genuinely new account sees.
 *
 * Kept because the first-run state is the one screen the mock suite can never
 * test — the mock always has a seeded workspace, so nobody ever meets the
 * empty case there.
 */

test('a new account can register and reach the application', async ({ page }) => {
  const account = newAccount()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await register(page, account)

  await expect(page).toHaveURL(/\/app\/dashboard/)
  // Anything the console complained about during a clean first run is worth
  // seeing in the report, whether or not it failed an assertion.
  console.log('console errors:', errors)
  await page.screenshot({ path: 'e2e-artifacts/first-run.png', fullPage: true })
})
