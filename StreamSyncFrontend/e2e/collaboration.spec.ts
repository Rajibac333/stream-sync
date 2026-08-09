import { expect, test, type Browser, type Page } from '@playwright/test'

import { newAccount, register, workspaceIdFrom, type Account } from './helpers'

/**
 * Two browsers, one document. (CLAUDE.md §5)
 *
 * The product's central claim — "User B immediately sees the change without
 * refreshing" — and the one thing no single-page test can check. It needs two
 * independent browser contexts, two sockets, and a real channel layer between
 * them.
 *
 * A failure here is not cosmetic: it means the WebSocket handshake, the
 * subprotocol token, the room, the broadcast, or the frame shape is wrong, and
 * every one of those is invisible to the REST suite.
 */

async function createWorkspaceWithDocument(page: Page, account: Account) {
  await register(page, account)

  await page.getByRole('button', { name: /Create workspace|Create your first workspace/ }).first().click()
  const workspaceDialog = page.getByRole('dialog')
  await workspaceDialog.getByLabel(/^Name/).fill('Realtime Co')
  await workspaceDialog.getByRole('button', { name: 'Create workspace' }).click()

  await expect(page.getByRole('button', { name: /Workspace: Realtime Co/ })).toBeVisible({
    timeout: 20_000,
  })

  await page.getByRole('navigation').getByRole('link', { name: 'Documents', exact: true }).first().click()
  await expect(page).toHaveURL(/\/documents$/, { timeout: 20_000 })

  await page.getByRole('button', { name: /New document/i }).first().click()
  const documentDialog = page.getByRole('dialog')
  await documentDialog.getByLabel(/^Title/).fill('Shared Requirements')
  await documentDialog.getByRole('button', { name: /^Create document$/ }).click()

  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 20_000 })
  return { url: page.url(), workspaceId: workspaceIdFrom(page.url()) }
}

/** A second person, invited into the workspace and signed in in their own context. */
async function inviteAndSignIn(
  browser: Browser,
  page: Page,
  workspaceId: string,
  guest: Account,
): Promise<Page> {
  // The invitee must already have an account — the backend invites by email and
  // will not create one, which is exactly what it says when you try.
  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  await register(guestPage, guest)

  await page.goto(`/app/workspaces/${workspaceId}/members`)
  await page.getByRole('button', { name: /Invite|Add member/i }).first().click()

  const form = page.getByRole('dialog').or(page.locator('form')).first()
  await form.getByLabel(/email/i).fill(guest.email)
  await page.getByRole('button', { name: /^(Send invitation|Invite)$/i }).first().click()
  await expect(page.getByText(new RegExp(guest.name, 'i')).first()).toBeVisible({ timeout: 20_000 })

  // Accepting is the guest's own action; the invitation appears on their side.
  await guestPage.goto('/app/dashboard')
  await guestPage.getByRole('button', { name: /^(Accept|Join)/i }).first().click()

  return guestPage
}

test('an edit by one person appears for another without a refresh', async ({ browser, page }) => {
  const host = newAccount('Host')
  const guest = newAccount('Guest')

  const { url, workspaceId } = await createWorkspaceWithDocument(page, host)
  const guestPage = await inviteAndSignIn(browser, page, workspaceId, guest)

  await test.step('both people open the same document', async () => {
    // The host has been on the members screen inviting; back to the document.
    await page.goto(url)
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({
      timeout: 20_000,
    })

    await guestPage.goto(url)
    await expect(guestPage.getByRole('textbox', { name: 'Document body' })).toBeVisible({
      timeout: 20_000,
    })

    /* Presence. The strip renders initials, so the name lives in the avatar's
       accessible name — asserting on page *text* would silently pass on
       something else entirely, which is what an earlier version of this test
       did. */
    await expect(
      page.getByRole('img', { name: new RegExp(guest.name, 'i') }).first(),
    ).toBeVisible({ timeout: 20_000 })
  })

  await test.step('the host types and the guest sees it', async () => {
    const body = page.getByRole('textbox', { name: 'Document body' })
    await body.click()
    await body.pressSequentially('Stripe will be used for payment processing.')

    // No reload anywhere in this assertion — that is the whole point.
    await expect(guestPage.getByText('Stripe will be used for payment processing.')).toBeVisible({
      timeout: 20_000,
    })
  })

  await guestPage.context().close()
})
