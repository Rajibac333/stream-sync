import { Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Input, type InputProps } from '@/components/ui/Input'
import { passwordRules } from '@/schemas/auth'
import { cn } from '@/utils/cn'

/**
 * Password input with a reveal toggle.
 *
 * Revealing a password is an accessibility and accuracy feature, not a
 * security hole — it is far better than the alternative, which is users
 * choosing shorter passwords because they cannot see what they typed. The
 * toggle is a real button with `aria-pressed`, so its state is announced.
 */

export interface PasswordFieldProps extends Omit<InputProps, 'type' | 'trailingSlot'> {}

export function PasswordField({ autoComplete = 'current-password', ...props }: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <Input
      type={revealed ? 'text' : 'password'}
      autoComplete={autoComplete}
      // Password managers and browsers handle these; turning them off would
      // only push users toward weaker, memorable passwords.
      spellCheck={false}
      trailingSlot={
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          // Excluded from the tab sequence on purpose: it sits between the
          // password field and the submit button, and stopping there on the way
          // to "Sign in" is friction on the path users actually take. It stays
          // reachable by pointer and by screen-reader navigation.
          tabIndex={-1}
        >
          {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      }
      {...props}
    />
  )
}

export interface PasswordRequirementsProps {
  /** Current password value — the checklist reflects it live. */
  value: string
  /** Wire this into the password input's `aria-describedby`. */
  id?: string
  className?: string
}

/**
 * Live checklist of the password policy. (CLAUDE.md §25)
 *
 * Shown *before* the user fails, so the rules are guidance rather than a
 * post-hoc scolding. Deliberately not a live region: re-announcing three items
 * on every keystroke is unusable. Instead each item states its own status in
 * text, and the list is referenced by the input's `aria-describedby` so it is
 * discoverable at the point it matters.
 */
export function PasswordRequirements({ value, id, className }: PasswordRequirementsProps) {
  const generatedId = useId()

  return (
    <ul id={id ?? generatedId} className={cn('flex flex-col gap-1', className)}>
      {passwordRules.map((rule) => {
        const met = rule.test(value)

        return (
          <li key={rule.id} className="flex items-center gap-2 text-caption">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                'duration-(--duration-fast)',
                met
                  ? 'border-success bg-success text-success-foreground'
                  : 'border-border text-transparent',
              )}
            >
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.25">
                <path d="M2.5 6.2 4.8 8.5 9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>

            <span className={met ? 'text-foreground-muted' : 'text-foreground-subtle'}>
              {rule.label}
            </span>
            <span className="sr-only">{met ? '— met' : '— not yet met'}</span>
          </li>
        )
      })}
    </ul>
  )
}
