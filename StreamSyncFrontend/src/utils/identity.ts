/** Helpers for rendering people consistently across avatars, cursors and mentions. */

/**
 * "Maria Gonzalez" → "MG", "raj@example.com" → "R".
 * Falls back to "?" so an avatar never renders empty.
 */
export function getInitials(name: string): string {
  const cleaned = name.trim()
  if (cleaned === '') return '?'

  // Email-shaped input: initials from the local part, never from the domain.
  const source = cleaned.includes('@') ? (cleaned.split('@')[0] ?? cleaned) : cleaned

  const words = source.split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'

  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''

  return (first + last).toUpperCase() || '?'
}

/** Number of presence colours defined in tokens.css. */
export const PRESENCE_COLOR_COUNT = 8

/**
 * Maps a stable id to one of the presence colours.
 *
 * Deterministic on purpose: a collaborator must keep the same colour across
 * reloads, across sessions, and — critically — across *different clients*, so
 * everyone in a document sees Maria as the same colour. Derived from the user
 * id rather than from join order, which differs per client. (CLAUDE.md §36)
 */
export function getPresenceColorIndex(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % PRESENCE_COLOR_COUNT) + 1
}
