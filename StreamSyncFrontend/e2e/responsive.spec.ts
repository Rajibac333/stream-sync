import { expect, test } from '@playwright/test'

import { goToWorkspace, navigationScope, registerWithWorkspace } from './helpers'

/**
 * Phone behaviour. (CLAUDE.md §18)
 *
 * Runs at 375px in the `mobile` project. These assert the things that are
 * *behaviourally* different on a phone rather than merely narrower — the
 * sidebar becomes a focus-trapped drawer, and the page must never scroll
 * sideways, which is the failure a viewport-width test catches and a component
 * test never will.
 */

test('replaces the sidebar with a drawer', async ({ page }) => {
  const { workspaceId } = await registerWithWorkspace(page)
  await goToWorkspace(page, workspaceId, 'projects')
  await page.waitForLoadState('networkidle')

  // The persistent sidebar is hidden below `md`.
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden()

  await page.getByRole('button', { name: 'Open navigation' }).click()

  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await expect(drawer).toBeVisible()

  // Escape closes it — the modal contract, not just a visual overlay.
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
})

test('navigates from the drawer and closes it', async ({ page }) => {
  const { workspaceId } = await registerWithWorkspace(page)

  /* Land on a settled screen first. Creating a workspace navigates, and the
     drawer closes on every route change — opening it while the app is still
     moving means clicking a link that is about to be torn down. */
  await goToWorkspace(page, workspaceId, 'projects')
  await page.waitForLoadState('networkidle')

  const navigation = await navigationScope(page)
  await navigation.getByRole('link', { name: 'Documents', exact: true }).click()

  await expect(page).toHaveURL(/\/documents/)
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden()
})

test('does not scroll sideways on any workspace screen', async ({ page }) => {
  const { workspaceId } = await registerWithWorkspace(page)

  for (const section of ['tasks', 'documents', 'members']) {
    await goToWorkspace(page, workspaceId, section)
    await page.waitForLoadState('networkidle')

    /* A horizontally scrolling *page* is the classic mobile layout bug — one
       unbroken string or a fixed-width child and the whole document shifts.
       Regions that scroll on purpose (the Kanban board) do so inside their own
       container, which does not move `document.body`. */
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${section} scrolls sideways`).toBeLessThanOrEqual(1)
  }
})
