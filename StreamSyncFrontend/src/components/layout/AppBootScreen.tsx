import { Wordmark } from '@/components/layout/Logo'

/**
 * Shown while the session is being restored on a cold load.
 *
 * This exists to prevent the single worst first impression an authenticated app
 * can make: rendering the login screen for a few hundred milliseconds before
 * discovering the user was signed in all along. Until the session query
 * settles, the answer is "we don't know yet" — and that is what this screen
 * says. (CLAUDE.md §59, §69)
 */
export function AppBootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-4">
        <Wordmark className="opacity-90" />

        {/* A quiet, determinate-looking bar rather than a spinner: this wait is
            short, and a spinner at 300ms reads as a stall. */}
        <div
          className="h-0.5 w-32 overflow-hidden rounded-full bg-border"
          aria-hidden="true"
        >
          <div className="h-full w-1/3 animate-[boot-sweep_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>

        <p role="status" className="sr-only">
          Restoring your session
        </p>
      </div>
    </div>
  )
}
