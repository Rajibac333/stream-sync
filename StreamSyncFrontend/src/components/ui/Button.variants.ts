import { cva } from 'class-variance-authority'

/**
 * Button style recipe.
 *
 * Kept in its own module so it can be applied to elements that are *not*
 * buttons — most importantly react-router `<Link>`, which must render an <a>
 * to remain a real link while still looking like a button.
 *
 * (It also keeps Button.tsx a components-only module, which is what React Fast
 * Refresh needs to hot-reload it.)
 */
export const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium select-none',
    'transition-[background-color,border-color,color,box-shadow,opacity]',
    'duration-(--duration-fast) ease-(--ease-out-quart)',
    // One focus treatment for every variant, sourced from --ss-focus.
    'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
    'focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        secondary: [
          'bg-surface text-foreground border border-border shadow-xs',
          'hover:bg-surface-hover hover:border-border-strong active:bg-surface-active',
        ],
        ghost: 'text-foreground-muted hover:bg-surface-hover hover:text-foreground active:bg-surface-active',
        subtle: 'bg-primary-subtle text-primary-subtle-foreground hover:brightness-95 dark:hover:brightness-125',
        danger: 'bg-danger text-danger-foreground hover:brightness-110 active:brightness-95',
        link: 'text-primary underline-offset-4 hover:underline h-auto p-0',
      },
      size: {
        sm: 'h-7 rounded-md px-2.5 text-caption gap-1.5 [&_svg]:size-3.5',
        md: 'h-8 rounded-md px-3 text-body [&_svg]:size-4',
        lg: 'h-10 rounded-md px-4 text-body-lg [&_svg]:size-4',
        // Square targets for icon-only actions. Callers must pass `aria-label`.
        'icon-sm': 'size-7 rounded-md [&_svg]:size-3.5',
        icon: 'size-8 rounded-md [&_svg]:size-4',
        'icon-lg': 'size-10 rounded-md [&_svg]:size-[1.125rem]',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)
