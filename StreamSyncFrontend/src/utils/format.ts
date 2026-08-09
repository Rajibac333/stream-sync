/**
 * Display formatting helpers.
 *
 * Built on `Intl` rather than a date library: the browser already ships correct
 * localisation, and pulling in a dependency for "3 minutes ago" would be
 * exactly the kind of addition CLAUDE.md §7 rules out.
 */

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto', // "yesterday" rather than "1 day ago"
  style: 'short',
})

const DIVISIONS: readonly { limitSeconds: number; seconds: number; unit: Intl.RelativeTimeFormatUnit }[] =
  [
    { limitSeconds: 60, seconds: 1, unit: 'second' },
    { limitSeconds: 3_600, seconds: 60, unit: 'minute' },
    { limitSeconds: 86_400, seconds: 3_600, unit: 'hour' },
    { limitSeconds: 604_800, seconds: 86_400, unit: 'day' },
    { limitSeconds: 2_629_800, seconds: 604_800, unit: 'week' },
    { limitSeconds: 31_557_600, seconds: 2_629_800, unit: 'month' },
    { limitSeconds: Number.POSITIVE_INFINITY, seconds: 31_557_600, unit: 'year' },
  ]

/**
 * "4m ago", "yesterday", "2 mo. ago".
 *
 * Anything under a minute reads as "just now" — counting individual seconds is
 * noise, and it makes a timestamp that re-renders look jittery.
 */
export function formatRelativeTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp)
  if (Number.isNaN(timestamp)) return ''

  const deltaSeconds = (timestamp - Date.now()) / 1000
  const magnitude = Math.abs(deltaSeconds)

  if (magnitude < 45) return 'Just now'

  const division = DIVISIONS.find((candidate) => magnitude < candidate.limitSeconds)
  if (!division) return ''

  return relativeFormatter.format(Math.round(deltaSeconds / division.seconds), division.unit)
}

const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Full timestamp, for the `title`/tooltip behind a relative one. */
export function formatAbsoluteTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp)
  if (Number.isNaN(timestamp)) return ''
  return absoluteFormatter.format(timestamp)
}

/** Caps a badge count so a wide number can't stretch its container. */
export function formatCount(count: number, max = 99): string {
  return count > max ? `${max}+` : String(count)
}

/* -----------------------------------------------------------------------------
 * Due dates
 *
 * A due date is a *date*, not an instant — "2026-08-14", with no timezone. It
 * is compared by calendar day rather than by elapsed milliseconds, because a
 * task due today is still due today at 11pm, and `Date.now()` arithmetic would
 * call that "in 1 hour" or, worse, overdue.
 * -------------------------------------------------------------------------- */

const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** Local calendar day as `YYYY-MM-DD`, matching the API's due-date format. */
export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Whole days from today to `dueDate`. Negative means overdue. */
export function daysUntil(dueDate: string, from = todayIso()): number {
  const due = Date.parse(`${dueDate}T00:00:00`)
  const base = Date.parse(`${from}T00:00:00`)
  if (Number.isNaN(due) || Number.isNaN(base)) return 0
  return Math.round((due - base) / 86_400_000)
}

export interface DueDateDisplay {
  label: string
  /** Drives colour. Never the only signal — the label always says it too. */
  tone: 'overdue' | 'today' | 'soon' | 'later'
}

export function formatDueDate(dueDate: string, from = todayIso()): DueDateDisplay {
  const days = daysUntil(dueDate, from)

  if (days < 0) {
    const overdue = Math.abs(days)
    return { label: overdue === 1 ? 'Overdue by 1 day' : `Overdue by ${overdue} days`, tone: 'overdue' }
  }
  if (days === 0) return { label: 'Due today', tone: 'today' }
  if (days === 1) return { label: 'Due tomorrow', tone: 'soon' }
  if (days <= 6) return { label: `Due in ${days} days`, tone: 'soon' }

  const parsed = Date.parse(`${dueDate}T00:00:00`)
  return { label: Number.isNaN(parsed) ? '' : dayFormatter.format(parsed), tone: 'later' }
}
