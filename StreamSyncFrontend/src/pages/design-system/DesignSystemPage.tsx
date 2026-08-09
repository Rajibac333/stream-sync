import { FileText, Plus, Search, Settings, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { ThemeToggle } from '@/components/layout/ThemeToggle'
import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  Input,
  Popover,
  Select,
  Skeleton,
  SkeletonText,
  Tab,
  TabPanel,
  Tabs,
  TabsList,
  Textarea,
  Tooltip,
} from '@/components/ui'
import { toast } from '@/store/toastStore'

/**
 * Living reference for the design system.
 *
 * Not an application screen — it exists so the foundation can be reviewed,
 * regression-checked in both themes, and handed to anyone building on top of
 * it. Dev-only; the route is not registered in production builds.
 */

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border py-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 text-foreground">{title}</h2>
        {description ? <p className="text-small text-foreground-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
      <span className="w-28 shrink-0 text-caption font-medium text-foreground-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

const SWATCHES = [
  { token: 'background', className: 'bg-background' },
  { token: 'surface', className: 'bg-surface' },
  { token: 'surface-muted', className: 'bg-surface-muted' },
  { token: 'border', className: 'bg-border' },
  { token: 'primary', className: 'bg-primary' },
  { token: 'primary-hover', className: 'bg-primary-hover' },
  { token: 'success', className: 'bg-success' },
  { token: 'warning', className: 'bg-warning' },
  { token: 'danger', className: 'bg-danger' },
  { token: 'muted', className: 'bg-muted' },
  { token: 'foreground', className: 'bg-foreground' },
  { token: 'focus', className: 'bg-focus' },
]

const TYPE_SCALE = [
  { name: 'display', className: 'text-display' },
  { name: 'h1', className: 'text-h1' },
  { name: 'h2', className: 'text-h2' },
  { name: 'h3', className: 'text-h3' },
  { name: 'body-lg', className: 'text-body-lg' },
  { name: 'body', className: 'text-body' },
  { name: 'small', className: 'text-small' },
  { name: 'caption', className: 'text-caption' },
]

const SPACING_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20]
const SPACING_PX: Record<number, number> = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80,
}

const RADII = [
  { name: 'sm — 6px', className: 'rounded-sm' },
  { name: 'md — 8px (controls)', className: 'rounded-md' },
  { name: 'lg — 12px (cards)', className: 'rounded-lg' },
  { name: 'xl — 16px (dialogs)', className: 'rounded-xl' },
  { name: 'full (avatars)', className: 'rounded-full' },
]

const SHADOWS = ['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl']

const COLLABORATORS = [
  { id: 'u_1', name: 'Raj Ahmed' },
  { id: 'u_2', name: 'Maria Gonzalez' },
  { id: 'u_3', name: 'Alex Chen' },
  { id: 'u_4', name: 'Priya Nair' },
  { id: 'u_5', name: 'Tom Becker' },
  { id: 'u_6', name: 'Sofia Rossi' },
]

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

export function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')

  const emailError =
    email.length > 0 && !email.includes('@') ? 'Enter a valid email address.' : undefined

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-13 max-w-4xl items-center gap-3 px-6">
          <span className="size-4 rounded-xs bg-primary" aria-hidden="true" />
          <span className="text-body font-semibold text-foreground">StreamSync</span>
          <Badge size="sm" variant="outline">
            Design system
          </Badge>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-24">
        <div className="flex flex-col gap-3 py-12">
          <h1 className="text-display text-balance text-foreground">Foundation</h1>
          <p className="max-w-xl text-body-lg text-foreground-muted">
            Tokens and primitives for StreamSync. Every colour, size and radius below resolves
            from a semantic token, so switching the theme in the corner re-themes this entire page
            without a single <code className="font-mono text-body">dark:</code> class.
          </p>
        </div>

        <Section title="Colour" description="Semantic tokens only. Primitives are never used directly in components.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SWATCHES.map(({ token, className }) => (
              <div key={token} className="flex flex-col gap-1.5">
                <div className={`h-12 rounded-md border border-border ${className}`} />
                <code className="font-mono text-caption text-foreground-muted">{token}</code>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <span
                  className="size-4 rounded-full"
                  style={{ backgroundColor: `var(--ss-presence-${index + 1})` }}
                  aria-hidden="true"
                />
                <code className="font-mono text-caption text-foreground-muted">
                  presence-{index + 1}
                </code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography" description="Inter, three weights, 14px body.">
          <div className="flex flex-col gap-4">
            {TYPE_SCALE.map(({ name, className }) => (
              <div key={name} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
                <code className="w-28 shrink-0 font-mono text-caption text-foreground-subtle">
                  {name}
                </code>
                <p className={`${className} text-foreground`}>
                  Teams work together without switching tools
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Spacing" description="4px base. The Tailwind numeric scale is the approved ramp.">
          <div className="flex flex-col gap-2">
            {SPACING_STEPS.map((step) => (
              <div key={step} className="flex items-center gap-4">
                <code className="w-16 shrink-0 font-mono text-caption text-foreground-subtle">
                  {step} · {SPACING_PX[step]}px
                </code>
                <div className="h-3 rounded-xs bg-primary-subtle" style={{ width: `${SPACING_PX[step]}px` }} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Radius & elevation" description="Restrained by policy — hierarchy comes from spacing, type and borders.">
          <div className="flex flex-wrap gap-4">
            {RADII.map(({ name, className }) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <div className={`size-16 border border-border bg-surface-muted ${className}`} />
                <code className="font-mono text-caption text-foreground-muted">{name}</code>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-4">
            {SHADOWS.map((shadow) => (
              <div key={shadow} className="flex flex-col items-center gap-2">
                <div className={`size-16 rounded-lg border border-border bg-surface ${shadow}`} />
                <code className="font-mono text-caption text-foreground-muted">{shadow}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-col gap-4">
            <Row label="Variants">
              <Button variant="primary">Create project</Button>
              <Button variant="secondary">Cancel</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="subtle">Subtle</Button>
              <Button variant="danger">Delete</Button>
              <Button variant="link">Learn more</Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add">
                <Plus aria-hidden="true" />
              </Button>
            </Row>
            <Row label="States">
              <Button variant="primary" leadingIcon={<Plus aria-hidden="true" />}>
                With icon
              </Button>
              <Button variant="primary" loading loadingLabel="Saving document">
                Save
              </Button>
              <Button disabled>Disabled</Button>
            </Row>
          </div>
        </Section>

        <Section title="Form controls" description="Label, hint and error wiring is built in, not left to the caller.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              label="Email"
              type="email"
              placeholder="you@company.com"
              hint="We'll send the workspace invitation here."
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={emailError}
              required
            />
            <Select label="Role" options={ROLE_OPTIONS} placeholder="Select a role…" required />
            <Input label="Search" hideLabel placeholder="Search documents…" leadingIcon={<Search />} />
            <Input label="Disabled" placeholder="Read-only workspace" disabled />
            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                placeholder="What is this project about?"
                maxLength={200}
                showCount
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <Checkbox label="Remember me" defaultChecked />
            <Checkbox
              label="Email notifications"
              description="Mentions and task assignments only."
            />
          </div>
        </Section>

        <Section
          title="Alerts"
          description="In-context messages. Danger and warning announce as alerts; the rest as status."
        >
          <div className="flex flex-col gap-3">
            <Alert variant="info" title="Version history">
              Restoring a version writes a new one — nothing is ever overwritten.
            </Alert>
            <Alert variant="success" title="Invitation sent">
              Maria will get an email with a link to this workspace.
            </Alert>
            <Alert variant="warning" title="You have view-only access">
              Ask an owner to make you an editor to change this document.
            </Alert>
            <Alert variant="danger">That email and password don’t match. Please try again.</Alert>
          </div>
        </Section>

        <Section title="People" description="Presence colours are derived from user id, so a collaborator looks the same to everyone.">
          <div className="flex flex-col gap-4">
            <Row label="Sizes">
              <Avatar name="Raj Ahmed" userId="u_1" size="xs" />
              <Avatar name="Raj Ahmed" userId="u_1" size="sm" />
              <Avatar name="Raj Ahmed" userId="u_1" size="md" />
              <Avatar name="Raj Ahmed" userId="u_1" size="lg" />
              <Avatar name="Raj Ahmed" userId="u_1" size="xl" />
            </Row>
            <Row label="Presence">
              <Avatar name="Raj Ahmed" userId="u_1" status="online" />
              <Avatar name="Maria Gonzalez" userId="u_2" status="editing" />
              <Avatar name="Alex Chen" userId="u_3" status="idle" />
              <Avatar name="Tom Becker" userId="u_5" status="offline" />
            </Row>
            <Row label="Group">
              <AvatarGroup users={COLLABORATORS} max={4} />
            </Row>
          </div>
        </Section>

        <Section title="Badges">
          <Row label="Variants">
            <Badge>Neutral</Badge>
            <Badge variant="primary">In progress</Badge>
            <Badge variant="success" dot>
              Synced
            </Badge>
            <Badge variant="warning" dot>
              Reconnecting
            </Badge>
            <Badge variant="danger" dot>
              Offline
            </Badge>
            <Badge variant="outline">Draft</Badge>
          </Row>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Checkout redesign</CardTitle>
                <CardDescription>Updated 2 hours ago by Maria</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-small text-foreground-muted">
                  Bordered by default. Twenty of these read as a grid, not as twenty floating panels.
                </p>
              </CardContent>
              <CardFooter divided>
                <AvatarGroup users={COLLABORATORS.slice(0, 3)} size="sm" />
                <Badge variant="success" size="sm" className="ml-auto">
                  On track
                </Badge>
              </CardFooter>
            </Card>

            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Elevated</CardTitle>
                <CardDescription>Reserved for content that genuinely floats</CardDescription>
              </CardHeader>
              <CardContent>
                <SkeletonText lines={3} />
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Overlays" description="Dialog traps focus, Escape closes, focus returns to the trigger. Try it with the keyboard.">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>

            <Dropdown
              label="Document actions"
              trigger={
                <Button variant="secondary" trailingIcon={<Settings aria-hidden="true" />}>
                  Actions
                </Button>
              }
            >
              <DropdownItem icon={<FileText aria-hidden="true" />} shortcut="⌘D">
                Duplicate
              </DropdownItem>
              <DropdownItem icon={<Users aria-hidden="true" />}>Manage access</DropdownItem>
              <DropdownItem disabled>Move to project</DropdownItem>
              <DropdownSeparator />
              <DropdownItem variant="danger" icon={<Trash2 aria-hidden="true" />}>
                Delete
              </DropdownItem>
            </Dropdown>

            <Popover
              label="Filters"
              align="start"
              className="w-72"
              trigger={<Button variant="secondary">Open popover</Button>}
            >
              {(close) => (
                <div className="flex flex-col gap-3 p-3">
                  <p className="text-body font-medium text-foreground">Filter tasks</p>
                  <p className="text-small text-foreground-muted">
                    A popover holds an interface, not a list of commands — so Tab moves through it,
                    where Dropdown uses arrow keys.
                  </p>
                  <Select label="Status" hideLabel options={ROLE_OPTIONS} placeholder="Any status" />
                  <Button size="sm" variant="primary" onClick={close}>
                    Apply
                  </Button>
                </div>
              )}
            </Popover>

            <Tooltip content="Shown on hover and on focus. Escape dismisses it.">
              <Button variant="ghost">Hover or focus me</Button>
            </Tooltip>

            <Button
              variant="secondary"
              onClick={() =>
                toast.success({
                  title: 'Document saved',
                  description: 'All changes are synced.',
                  action: { label: 'View history', onClick: () => undefined },
                })
              }
            >
              Show toast
            </Button>

            <Button
              variant="secondary"
              onClick={() =>
                toast.error({
                  title: "Couldn't reach StreamSync",
                  description: 'Reconnecting…',
                })
              }
            >
              Show error toast
            </Button>
          </div>

          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title='Share "Product Requirements"'
            description="Invite people to collaborate on this document."
            footer={
              <>
                <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDialogOpen(false)
                    toast.success({ title: 'Invitation sent' })
                  }}
                >
                  Send invitation
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4 py-2">
              <Input label="Email" type="email" placeholder="teammate@company.com" />
              <Select label="Role" options={ROLE_OPTIONS.slice(1)} defaultValue="editor" />
            </div>
          </Dialog>
        </Section>

        <Section title="Tabs" description="Roving tabindex — ← → move between tabs, Tab steps over the strip.">
          <Tabs defaultValue="overview">
            <TabsList label="Project sections">
              <Tab value="overview">Overview</Tab>
              <Tab value="documents" icon={<FileText aria-hidden="true" />} count={12}>
                Documents
              </Tab>
              <Tab value="tasks" count={4}>
                Tasks
              </Tab>
              <Tab value="activity" disabled>
                Activity
              </Tab>
            </TabsList>
            <TabPanel value="overview">
              <p className="text-small text-foreground-muted">Project overview content.</p>
            </TabPanel>
            <TabPanel value="documents">
              <p className="text-small text-foreground-muted">Twelve documents.</p>
            </TabPanel>
            <TabPanel value="tasks">
              <p className="text-small text-foreground-muted">Four open tasks.</p>
            </TabPanel>
          </Tabs>
        </Section>

        <Section title="Loading, empty and error" description="Every screen ships all three. (Definition of Done, §74)">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-center gap-3">
                  <Skeleton shape="circle" className="size-8" />
                  <div className="flex-1">
                    <Skeleton shape="text" className="w-2/3" />
                  </div>
                </div>
                <SkeletonText lines={3} />
              </CardContent>
            </Card>

            <Card>
              <EmptyState
                size="inline"
                icon={<FileText />}
                title="No documents yet"
                description="Create your first document and start collaborating."
                action={
                  <Button size="sm" variant="primary" leadingIcon={<Plus aria-hidden="true" />}>
                    Create document
                  </Button>
                }
              />
            </Card>

            <Card>
              <ErrorState
                size="inline"
                title="Couldn't load documents"
                description="We couldn't reach StreamSync. Check your connection and try again."
                onRetry={() => toast.show({ title: 'Retrying…' })}
              />
            </Card>
          </div>
        </Section>
      </main>
    </div>
  )
}
