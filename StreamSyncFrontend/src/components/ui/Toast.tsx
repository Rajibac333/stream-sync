import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ComponentType, ReactNode } from 'react'

import { useToastStore, type Toast as ToastData, type ToastVariant } from '@/store/toastStore'
import { cn } from '@/utils/cn'

/**
 * Toast viewport.
 *
 * Mounted once, near the root. Rendering it in a portal keeps it out of any
 * transformed ancestor, and the live region is *always present* rather than
 * created on demand — a live region added to the DOM at the same moment as its
 * content is frequently not announced at all.
 *
 * CLAUDE.md §62
 */

const VARIANT_ICONS: Record<ToastVariant, ComponentType<{ className?: string }>> = {
  default: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
}

const VARIANT_ICON_COLORS: Record<ToastVariant, string> = {
  default: 'text-foreground-subtle',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

function ToastCard({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const Icon = VARIANT_ICONS[toast.variant]
  const reduceMotion = useReducedMotion()

  return (
    <motion.li
      layout={!reduceMotion}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border',
        'bg-surface-raised p-3 shadow-lg',
      )}
    >
      <Icon className={cn('mt-px size-4 shrink-0', VARIANT_ICON_COLORS[toast.variant])} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-body font-medium text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="text-small text-foreground-muted">{toast.description}</p>
        ) : null}

        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick()
              onDismiss()
            }}
            className={cn(
              'mt-1.5 self-start rounded-sm text-small font-medium text-primary',
              'outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus',
            )}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss: ${toast.title}`}
        className={cn(
          'shrink-0 rounded-sm p-0.5 text-foreground-subtle',
          'transition-colors duration-(--duration-instant) hover:text-foreground',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus',
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </motion.li>
  )
}

export function ToastViewport(): ReactNode {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  return createPortal(
    <div
      // `polite` never interrupts; an error toast is still not worth cutting
      // off whatever the user is currently having read to them.
      role="region"
      aria-label="Notifications"
      className={cn(
        'pointer-events-none fixed z-[60] flex flex-col gap-2',
        // Bottom sheet on mobile, bottom-right column on desktop.
        'inset-x-3 bottom-3 sm:left-auto sm:right-4 sm:w-88 sm:max-w-[calc(100vw-2rem)]',
      )}
    >
      <ol aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </AnimatePresence>
      </ol>
    </div>,
    document.body,
  )
}
