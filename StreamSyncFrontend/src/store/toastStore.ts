import { create } from 'zustand'

/**
 * Toast queue.
 *
 * Lives in a store rather than in React context so that non-component code —
 * API error handlers, WebSocket reconnect logic, mutation callbacks — can raise
 * a toast without needing a hook. (CLAUDE.md §62)
 */

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger'

export interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  /** Milliseconds on screen. `null` keeps it until dismissed. */
  duration: number | null
  action?: { label: string; onClick: () => void }
}

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number | null
  action?: { label: string; onClick: () => void }
}

interface ToastState {
  toasts: Toast[]
  push: (options: ToastOptions) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

/** More than a few stacked toasts is noise, not feedback. (CLAUDE.md §62) */
const MAX_VISIBLE = 4
const DEFAULT_DURATION = 5_000

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: ({ title, description, variant = 'default', duration = DEFAULT_DURATION, action }) => {
    const id = crypto.randomUUID()

    const toast: Toast = {
      id,
      title,
      variant,
      duration,
      ...(description !== undefined ? { description } : {}),
      ...(action !== undefined ? { action } : {}),
    }

    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE) }))

    if (duration !== null) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), duration),
      )
    }

    return id
  },

  dismiss: (id) => {
    clearTimer(id)
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  dismissAll: () => {
    for (const id of timers.keys()) clearTimer(id)
    set({ toasts: [] })
  },
}))

/**
 * Imperative API for use outside React.
 *
 *   toast.success({ title: 'Document saved' })
 */
export const toast = {
  show: (options: ToastOptions) => useToastStore.getState().push(options),
  success: (options: Omit<ToastOptions, 'variant'>) =>
    useToastStore.getState().push({ ...options, variant: 'success' }),
  warning: (options: Omit<ToastOptions, 'variant'>) =>
    useToastStore.getState().push({ ...options, variant: 'warning' }),
  error: (options: Omit<ToastOptions, 'variant'>) =>
    useToastStore.getState().push({ ...options, variant: 'danger' }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  dismissAll: () => useToastStore.getState().dismissAll(),
}
