/**
 * URL handling for user-entered links. (CLAUDE.md §34, §66)
 *
 * Kept out of LinkDialog.tsx so that file exports components only (a mixed
 * module is not a Fast Refresh boundary), and because this is a security
 * boundary that deserves to be tested on its own.
 */

/**
 * Protocols a document link may use.
 *
 * `javascript:` in an href is script execution dressed as a link. Tiptap
 * sanitises too, but a document is user-generated content shared across a whole
 * workspace, and validating at the point of entry means a hostile value never
 * enters the stored content in the first place.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Normalises what a person typed into a safe absolute URL, or null.
 *
 * A bare domain — "streamsync.app" — is what users actually type, so it is
 * upgraded to https rather than rejected or turned into a relative path.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
