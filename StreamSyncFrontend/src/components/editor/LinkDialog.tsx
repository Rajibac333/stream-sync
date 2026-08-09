import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { normalizeUrl } from '@/utils/url'

/**
 * Link insertion. (CLAUDE.md §34)
 *
 * A dialog rather than `window.prompt`, which cannot be styled, cannot be
 * keyboard-managed, and is blocked outright in some embedded contexts.
 *
 * The URL is validated by `normalizeUrl` before it reaches the document — see
 * utils/url.ts for why that matters.
 */

export interface LinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editor: Editor | null
}

export function LinkDialog({ open, onOpenChange, editor }: LinkDialogProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Seed with the existing href when editing a link rather than creating one.
  useEffect(() => {
    if (!open || !editor) return
    setValue(String(editor.getAttributes('link').href ?? ''))
    setError(null)
  }, [open, editor])

  const existing = editor?.isActive('link') ?? false

  const apply = () => {
    if (!editor) return

    const normalized = normalizeUrl(value)
    if (!normalized) {
      setError('Enter a valid web or email address.')
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run()
    onOpenChange(false)
  }

  const remove = () => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Edit link' : 'Add link'}
      size="sm"
      initialFocusRef={inputRef}
      footer={
        <>
          {existing ? (
            <Button variant="ghost" onClick={remove} className="mr-auto">
              Remove link
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply}>
            {existing ? 'Update' : 'Add link'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
        className="pb-2"
      >
        <Input
          ref={inputRef}
          label="URL"
          placeholder="streamsync.app/docs"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          {...(error ? { error } : {})}
          hint="Web addresses and mailto: links only."
        />
      </form>
    </Dialog>
  )
}
