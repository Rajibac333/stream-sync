import { createContext, useCallback, useContext, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * Tabs — WAI-ARIA tabs pattern with roving tabindex.
 *
 * Only the active tab is in the page's tab order; ← → move between tabs and
 * Home/End jump to the ends. That is the whole point of the pattern: a user
 * tabbing through a page steps *over* the tab strip in one keystroke instead of
 * being forced through every tab before reaching the panel.
 *
 * Activation is automatic (focus selects) since panels here are already-loaded
 * client state. If a panel ever triggers an expensive fetch, switch that
 * instance to `activation="manual"` so arrowing doesn't fire N requests.
 */

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
  baseId: string
  activation: 'automatic' | 'manual'
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error(`<${component}> must be rendered inside <Tabs>.`)
  }
  return context
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Controlled value. Omit for uncontrolled with `defaultValue`. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  activation?: 'automatic' | 'manual'
  children: ReactNode
}

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  activation = 'automatic',
  className,
  children,
  ...props
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const baseId = useId()

  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : uncontrolledValue

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolledValue(next)
      onValueChange?.(next)
    },
    [isControlled, onValueChange],
  )

  return (
    <TabsContext.Provider value={{ value, setValue, baseId, activation }}>
      <div className={cn('flex flex-col', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the tab strip, e.g. "Project sections". */
  label: string
}

export function TabsList({ label, className, children, ...props }: TabsListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current
    if (!list) return

    const tabs = Array.from(
      list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    )
    if (tabs.length === 0) return

    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement)
    if (currentIndex === -1) return

    const focusAt = (index: number) => {
      event.preventDefault()
      tabs[(index + tabs.length) % tabs.length]?.focus()
    }

    switch (event.key) {
      case 'ArrowRight':
        focusAt(currentIndex + 1)
        break
      case 'ArrowLeft':
        focusAt(currentIndex - 1)
        break
      case 'Home':
        focusAt(0)
        break
      case 'End':
        focusAt(tabs.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cn(
        // Horizontal scroll rather than wrap: a wrapped tab strip destroys the
        // page's vertical rhythm at 320px. (CLAUDE.md §18)
        'flex items-center gap-1 overflow-x-auto border-b border-border',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // A tab strip that overflows its container needs to *look* like it
        // scrolls, not like the last tab got clipped mid-word. Fading both
        // edges is a static, scroll-position-independent signal — cheap
        // enough to apply unconditionally, since a strip with room to spare
        // just renders an imperceptible few-pixel fade instead.
        '[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  value: string
  icon?: ReactNode
  /** Right-hand count, e.g. the number of open tasks. */
  count?: number
}

export function Tab({ value, icon, count, className, children, disabled, ...props }: TabProps) {
  const { value: activeValue, setValue, baseId, activation } = useTabsContext('Tab')
  const selected = activeValue === value

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      // Roving tabindex: exactly one tab is reachable with Tab.
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      onFocus={activation === 'automatic' && !disabled ? () => setValue(value) : undefined}
      className={cn(
        'relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-2',
        'border-b-2 text-body font-medium',
        'transition-[color,border-color] duration-(--duration-fast) ease-(--ease-out-quart)',
        'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
        'focus-visible:ring-offset-background focus-visible:rounded-t-sm',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        selected
          ? 'border-primary text-foreground'
          : 'border-transparent text-foreground-muted hover:text-foreground',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            'rounded-sm px-1.5 py-px text-caption tabular-nums',
            selected ? 'bg-primary-subtle text-primary-subtle-foreground' : 'bg-surface-muted text-foreground-subtle',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  /** Keeps the panel mounted while hidden — use to preserve scroll or form state. */
  keepMounted?: boolean
}

export function TabPanel({
  value,
  keepMounted = false,
  className,
  children,
  ...props
}: TabPanelProps) {
  const { value: activeValue, baseId } = useTabsContext('TabPanel')
  const selected = activeValue === value

  if (!selected && !keepMounted) return null

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      hidden={!selected}
      // Panels are focusable so that Tab from the strip lands in the content,
      // which is where the user actually wants to be.
      tabIndex={0}
      className={cn('pt-4 outline-none focus-visible:ring-2 focus-visible:ring-focus', className)}
      {...props}
    >
      {children}
    </div>
  )
}
