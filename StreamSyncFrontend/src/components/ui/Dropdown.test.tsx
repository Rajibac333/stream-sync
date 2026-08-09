import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/Button'
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown'
import { renderWithProviders } from '@/test/utils'

/**
 * Dropdown menu.
 *
 * Two properties this file exists to protect, both of which were bugs:
 *
 *   • the menu escapes its scrolling ancestor. It is portalled to <body> and
 *     positioned against the trigger, because an absolutely-positioned menu was
 *     clipped inside the Kanban board's scroller and the mobile nav drawer —
 *     and on the Kanban card that menu is the *only* non-drag way to move a
 *     task, which is exactly what touch users need.
 *
 *   • Escape closes it whatever opened it. The key handler used to live on the
 *     menu itself, so a menu opened by click — with focus still on the trigger
 *     — could not be dismissed from the keyboard.
 */

function renderMenu(onSelect = vi.fn()) {
  const result = renderWithProviders(
    // A scrolling ancestor, i.e. the situation that used to clip the menu.
    <div style={{ overflow: 'auto', height: 80 }} data-testid="scroller">
      <Dropdown
        label="Move task"
        trigger={<Button aria-label="Actions">…</Button>}
      >
        <DropdownItem onClick={onSelect}>In Progress</DropdownItem>
        <DropdownItem>Done</DropdownItem>
      </Dropdown>
    </div>,
  )
  return { ...result, onSelect }
}

describe('placement', () => {
  it('renders the menu outside its scrolling ancestor', async () => {
    const { user } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    const menu = await screen.findByRole('menu', { name: 'Move task' })
    const scroller = screen.getByTestId('scroller')

    // Portalled: the scroller cannot clip what it does not contain.
    expect(scroller.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)

    /* Positioned from a measurement rather than by CSS alone. Styles are not
       compiled under test (vitest.config.ts sets `css: false`), so the inline
       coordinates are the observable evidence that placement ran. */
    expect(menu.style.top).not.toBe('')
    expect(menu.style.left).not.toBe('')
    expect(menu.style.visibility).toBe('visible')
  })
})

describe('keyboard', () => {
  it('closes on Escape when opened by click, and returns focus to the trigger', async () => {
    const { user } = renderMenu()
    const trigger = screen.getByRole('button', { name: 'Actions' })

    await user.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('opens with ArrowDown and lands on the first item', async () => {
    const { user } = renderMenu()

    screen.getByRole('button', { name: 'Actions' }).focus()
    await user.keyboard('{ArrowDown}')

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'In Progress' })).toHaveFocus(),
    )
  })

  it('activates an item and closes', async () => {
    const { user, onSelect } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'In Progress' }))

    expect(onSelect).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})
