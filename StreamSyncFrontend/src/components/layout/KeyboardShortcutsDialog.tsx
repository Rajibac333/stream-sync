import { CircleHelp } from 'lucide-react'
import { useState } from 'react'

import { Dialog } from '@/components/ui/Dialog'
import { Tooltip } from '@/components/ui/Tooltip'
import { modifierKeyLabel } from '@/utils/platform'
import { cn } from '@/utils/cn'

/**
 * Keyboard shortcut reference.
 *
 * Lists only shortcuts that are actually implemented. A help dialog advertising
 * keys that do nothing is worse than no help dialog — it costs the user a real
 * attempt before they conclude the app is broken.
 */

interface Shortcut {
  keys: readonly string[]
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: readonly Shortcut[]
}

const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: [modifierKeyLabel, 'K'], description: 'Open the command menu' },
      { keys: [modifierKeyLabel, 'B'], description: 'Collapse or expand the sidebar' },
      { keys: ['Esc'], description: 'Close the open menu, dialog or panel' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Tab'], description: 'Move to the next control' },
      { keys: ['Shift', 'Tab'], description: 'Move to the previous control' },
      { keys: ['↑', '↓'], description: 'Move through menu and search results' },
      { keys: ['Enter'], description: 'Activate the highlighted item' },
    ],
  },
]

function Key({ children }: { children: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border',
        'bg-surface-muted px-1.5 font-sans text-caption font-medium text-foreground-muted',
      )}
    >
      {children}
    </kbd>
  )
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Everything below works today."
      size="md"
    >
      <div className="flex flex-col gap-6 pb-4">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-foreground-subtle">
              {group.title}
            </h3>

            <dl className="flex flex-col">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.description}
                  className="flex items-center justify-between gap-4 border-b border-border-subtle py-2 last:border-b-0"
                >
                  <dt className="text-body text-foreground-muted">{shortcut.description}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <Key key={key}>{key}</Key>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

/** Sidebar "Help" entry. Owns its own dialog so both sidebars can render one. */
export function HelpButton({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        'group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-body text-foreground-muted',
        'transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
        'focus-visible:ring-offset-background',
        collapsed && 'justify-center px-0',
      )}
    >
      <CircleHelp
        className="size-4 shrink-0 text-foreground-subtle group-hover:text-foreground-muted"
        aria-hidden="true"
      />
      <span className={cn('truncate', collapsed && 'sr-only')}>Help</span>
    </button>
  )

  return (
    <>
      {collapsed ? (
        <Tooltip content="Help" side="right" instant>
          {button}
        </Tooltip>
      ) : (
        button
      )}

      <KeyboardShortcutsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
