import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose class names, with later Tailwind utilities beating earlier ones.
 *
 * Without the merge step, `cn('px-4', 'px-6')` emits both and the winner is
 * decided by stylesheet order rather than by the caller — which quietly breaks
 * every component that accepts a `className` override.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
