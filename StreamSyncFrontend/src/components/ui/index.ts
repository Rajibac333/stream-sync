/**
 * UI foundation barrel.
 *
 * Feature code imports from `@/components/ui`, never from individual files, so
 * a primitive can be split or relocated without touching call sites.
 */

export { Alert, type AlertProps } from './Alert'
export { Avatar, AvatarGroup, type AvatarProps, type AvatarGroupProps, type PresenceStatus } from './Avatar'
export { Badge, type BadgeProps } from './Badge'
export { Button, type ButtonProps } from './Button'
// Style recipe, for elements that must look like a button but be something else
// (e.g. a router <Link>, which has to render an <a>).
export { buttonVariants } from './Button.variants'
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CardToolbar,
  type CardProps,
} from './Card'
export { Checkbox, type CheckboxProps } from './Checkbox'
export { Dialog, DialogBody, type DialogProps } from './Dialog'
export {
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  type DropdownItemProps,
} from './Dropdown'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { ErrorState, type ErrorStateProps } from './ErrorState'
export { Input, type InputProps } from './Input'
export { Popover, type PopoverProps } from './Popover'
export { ProgressBar, type ProgressBarProps } from './ProgressBar'
export { QueryState, type QueryStateProps } from './QueryState'
export { Select, type SelectOption, type SelectProps } from './Select'
export { Skeleton, SkeletonText, type SkeletonProps } from './Skeleton'
export { Tab, TabPanel, Tabs, TabsList, type TabProps, type TabsProps } from './Tabs'
export { Textarea, type TextareaProps } from './Textarea'
export { ToastViewport } from './Toast'
export { Tooltip, type TooltipProps } from './Tooltip'
