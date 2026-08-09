/**
 * Platform detection, for keyboard-shortcut display only.
 *
 * Showing "Ctrl K" to a Mac user is a small thing that makes an app feel
 * foreign. Detection is deliberately confined to *labels*: the handlers
 * themselves accept both modifiers, because UA sniffing is unreliable and
 * getting a shortcut wrong is worse than drawing the wrong glyph.
 */

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false

  // `userAgentData.platform` where available; `platform` is deprecated but is
  // still the only thing Safari and Firefox offer.
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = data?.platform ?? navigator.platform ?? ''

  return /mac|iphone|ipad|ipod/i.test(platform)
}

export const isMacPlatform = detectMac()

/** The modifier glyph for this platform: "⌘" or "Ctrl". */
export const modifierKeyLabel = isMacPlatform ? '⌘' : 'Ctrl'

/** Formats a shortcut for display, e.g. `shortcutLabel('K')` → "⌘K" / "Ctrl+K". */
export function shortcutLabel(key: string): string {
  return isMacPlatform ? `⌘${key}` : `Ctrl+${key}`
}

/** True when the platform's "command" modifier is held. */
export function hasCommandModifier(event: KeyboardEvent | React.KeyboardEvent): boolean {
  // Both are accepted regardless of platform: a user on an external Windows
  // keyboard plugged into a Mac should still get the shortcut they pressed.
  return event.metaKey || event.ctrlKey
}
