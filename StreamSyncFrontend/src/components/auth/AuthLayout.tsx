import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { LogoMark, Wordmark } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { routes } from '@/constants/routes'

/**
 * Shared chrome for the sign-in, register and password-reset screens.
 *
 * A two-column split above `lg`: a quiet brand panel on the left, the form on
 * the right. Below `lg` the panel is dropped entirely rather than stacked —
 * marketing copy above a login form on a phone is just something to scroll
 * past. (CLAUDE.md §18)
 *
 * The form column is a real <main> with a single <h1>, so each auth screen is a
 * correctly-structured page rather than a floating card.
 */

const HIGHLIGHTS = [
  {
    title: 'Write together, live',
    body: 'Documents sync as your team types, with presence and cursors built in.',
  },
  {
    title: 'Plan and track in one place',
    body: 'Projects, tasks and comments sit next to the work they describe.',
  },
  {
    title: 'AI that reads the room',
    body: 'Summarise a document, extract action items, turn them into tasks.',
  },
]

export interface AuthLayoutProps {
  title: string
  description?: ReactNode
  children: ReactNode
  /** Sign-in / sign-up cross-link below the form. */
  footer?: ReactNode
}

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ---------------------------------------------------------------
          Brand panel — presentational, and hidden from assistive tech would
          be wrong (the copy is real content), so it stays in the tree and is
          simply not rendered on small screens.
         --------------------------------------------------------------- */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-surface-muted p-10 lg:flex">
        {/* A single dot grid, masked to fade out. Texture without resorting to
            the gradient-and-glass look §11 rules out. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage: 'radial-gradient(var(--ss-border-strong) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 30% 20%, black, transparent 75%)',
          }}
        />

        <div className="relative">
          <Link
            to={routes.home}
            className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-4 focus-visible:ring-offset-surface-muted"
          >
            <Wordmark />
          </Link>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-h1 text-balance text-foreground">
            The workspace your team stops switching out of.
          </h2>

          <ul className="mt-8 flex flex-col gap-5">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight.title} className="flex gap-3">
                <LogoMark className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-body font-medium text-foreground">{highlight.title}</p>
                  <p className="mt-0.5 text-small text-foreground-muted">{highlight.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-caption text-foreground-subtle">
          Real-time collaborative workspace for distributed teams.
        </p>
      </aside>

      {/* ---------------------------------------------------------------
          Form column
         --------------------------------------------------------------- */}
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Link
            to={routes.home}
            className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-4 focus-visible:ring-offset-background lg:invisible"
            aria-label="StreamSync home"
          >
            <Wordmark />
          </Link>

          <ThemeToggle />
        </div>

        <main className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
          <div className="w-full max-w-sm">
            <header className="mb-7">
              <h1 className="text-h2 text-foreground">{title}</h1>
              {description ? (
                <p className="mt-1.5 text-body text-foreground-muted">{description}</p>
              ) : null}
            </header>

            {children}

            {footer ? (
              <div className="mt-7 border-t border-border pt-5 text-center text-small text-foreground-muted">
                {footer}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  )
}
