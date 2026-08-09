import type { Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Sparkles,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useCallback } from 'react'

import { Tooltip } from '@/components/ui/Tooltip'
import { modifierKeyLabel } from '@/utils/platform'
import { cn } from '@/utils/cn'

/**
 * Editor toolbar. (CLAUDE.md §34)
 *
 * A `role="toolbar"` with roving tabindex, which is the pattern the WAI-ARIA
 * practices prescribe and the one users of a toolbar expect: Tab moves *past*
 * the whole strip in one keystroke, and ← → move between its controls. A
 * toolbar of eighteen ordinary buttons forces a keyboard user through all
 * eighteen before reaching the text they came to write.
 *
 * Each button reports `aria-pressed`, so the active formatting is announced
 * rather than only shown as a highlight — and every action also has its native
 * shortcut, which the tooltip advertises.
 */

interface ToolbarAction {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
  run: () => void
  isActive?: () => boolean
  isDisabled?: () => boolean
}

export interface EditorToolbarProps {
  editor: Editor
  /** Opens the link dialog — owned by the page, since it is a dialog. */
  onLinkRequest: () => void
  /** Opens the AI panel on its rewrite tab, for the current selection. (§47) */
  onAiRequest?: () => void
  className?: string
}

export function EditorToolbar({
  editor,
  onLinkRequest,
  onAiRequest,
  className,
}: EditorToolbarProps) {
  /* ---------------------------------------------------------------------
     Keyboard: roving tabindex across the whole strip.
     --------------------------------------------------------------------- */
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const toolbar = event.currentTarget
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    if (buttons.length === 0) return

    const index = buttons.findIndex((button) => button === document.activeElement)
    if (index === -1) return

    const focusAt = (next: number) => {
      event.preventDefault()
      buttons[(next + buttons.length) % buttons.length]?.focus()
    }

    switch (event.key) {
      case 'ArrowRight':
        focusAt(index + 1)
        break
      case 'ArrowLeft':
        focusAt(index - 1)
        break
      case 'Home':
        focusAt(0)
        break
      case 'End':
        focusAt(buttons.length - 1)
        break
      default:
        break
    }
  }, [])

  const groups: ToolbarAction[][] = [
    [
      {
        id: 'undo',
        label: 'Undo',
        icon: Undo2,
        shortcut: `${modifierKeyLabel}Z`,
        run: () => editor.chain().focus().undo().run(),
        isDisabled: () => !editor.can().undo(),
      },
      {
        id: 'redo',
        label: 'Redo',
        icon: Redo2,
        shortcut: `${modifierKeyLabel}⇧Z`,
        run: () => editor.chain().focus().redo().run(),
        isDisabled: () => !editor.can().redo(),
      },
    ],
    [
      {
        id: 'paragraph',
        label: 'Paragraph',
        icon: Pilcrow,
        run: () => editor.chain().focus().setParagraph().run(),
        isActive: () => editor.isActive('paragraph'),
      },
      {
        id: 'h1',
        label: 'Heading 1',
        icon: Heading1,
        shortcut: `${modifierKeyLabel}⌥1`,
        run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: () => editor.isActive('heading', { level: 1 }),
      },
      {
        id: 'h2',
        label: 'Heading 2',
        icon: Heading2,
        shortcut: `${modifierKeyLabel}⌥2`,
        run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: () => editor.isActive('heading', { level: 2 }),
      },
      {
        id: 'h3',
        label: 'Heading 3',
        icon: Heading3,
        shortcut: `${modifierKeyLabel}⌥3`,
        run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: () => editor.isActive('heading', { level: 3 }),
      },
    ],
    [
      {
        id: 'bold',
        label: 'Bold',
        icon: Bold,
        shortcut: `${modifierKeyLabel}B`,
        run: () => editor.chain().focus().toggleBold().run(),
        isActive: () => editor.isActive('bold'),
      },
      {
        id: 'italic',
        label: 'Italic',
        icon: Italic,
        shortcut: `${modifierKeyLabel}I`,
        run: () => editor.chain().focus().toggleItalic().run(),
        isActive: () => editor.isActive('italic'),
      },
      {
        id: 'underline',
        label: 'Underline',
        icon: UnderlineIcon,
        shortcut: `${modifierKeyLabel}U`,
        run: () => editor.chain().focus().toggleUnderline().run(),
        isActive: () => editor.isActive('underline'),
      },
      {
        id: 'link',
        label: 'Link',
        icon: Link2,
        shortcut: `${modifierKeyLabel}K`,
        run: onLinkRequest,
        isActive: () => editor.isActive('link'),
      },
    ],
    [
      {
        id: 'bulletList',
        label: 'Bullet list',
        icon: List,
        shortcut: `${modifierKeyLabel}⇧8`,
        run: () => editor.chain().focus().toggleBulletList().run(),
        isActive: () => editor.isActive('bulletList'),
      },
      {
        id: 'orderedList',
        label: 'Numbered list',
        icon: ListOrdered,
        shortcut: `${modifierKeyLabel}⇧7`,
        run: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: () => editor.isActive('orderedList'),
      },
      {
        id: 'blockquote',
        label: 'Quote',
        icon: Quote,
        shortcut: `${modifierKeyLabel}⇧B`,
        run: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: () => editor.isActive('blockquote'),
      },
      {
        id: 'codeBlock',
        label: 'Code block',
        icon: Code,
        shortcut: `${modifierKeyLabel}⌥C`,
        run: () => editor.chain().focus().toggleCodeBlock().run(),
        isActive: () => editor.isActive('codeBlock'),
      },
    ],
  ]

  /* The assistant sits at the end of the strip, in its own group.
     Deliberately *not* disabled without a selection: the panel explains what to
     select far better than a dead button does, and a control that is grey
     whenever you look at it teaches people it does nothing. (§47) */
  if (onAiRequest) {
    groups.push([
      {
        id: 'ai',
        label: 'Ask AI to rewrite',
        icon: Sparkles,
        run: onAiRequest,
      },
    ])
  }

  // Exactly one control is in the page tab order — the roving tabindex anchor.
  let isFirstEnabled = true

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cn(
        'flex items-center gap-0.5 overflow-x-auto',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {groups.map((group, groupIndex) => (
        <div key={group[0]?.id ?? groupIndex} className="flex items-center gap-0.5">
          {groupIndex > 0 ? (
            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          ) : null}

          {group.map((action) => {
            const Icon = action.icon
            const active = action.isActive?.() ?? false
            const disabled = action.isDisabled?.() ?? false

            const tabIndex = !disabled && isFirstEnabled ? 0 : -1
            if (!disabled && isFirstEnabled) isFirstEnabled = false

            return (
              <Tooltip
                key={action.id}
                instant
                content={action.shortcut ? `${action.label} · ${action.shortcut}` : action.label}
              >
                <button
                  type="button"
                  onClick={action.run}
                  disabled={disabled}
                  tabIndex={tabIndex}
                  aria-label={action.label}
                  aria-pressed={action.isActive ? active : undefined}
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-md',
                    'transition-colors duration-(--duration-instant)',
                    'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    'disabled:pointer-events-none disabled:opacity-40',
                    active
                      ? 'bg-primary-subtle text-primary-subtle-foreground'
                      : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            )
          })}
        </div>
      ))}
    </div>
  )
}
