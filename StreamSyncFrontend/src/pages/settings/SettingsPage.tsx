import { zodResolver } from '@hookform/resolvers/zod'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Tab, TabPanel, Tabs, TabsList } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { useCurrentUser } from '@/hooks/useAuth'
import { useUpdateWorkspace } from '@/hooks/useMemberMutations'
import { useTheme } from '@/hooks/useTheme'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { updateWorkspaceSchema } from '@/schemas/content'
import type { ThemePreference } from '@/store/themeStore'
import { WorkspaceRole } from '@/types/auth'
import { applyFieldErrors } from '@/utils/formErrors'
import { formatAbsoluteTime } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Workspace settings. (CLAUDE.md §6, §24)
 *
 * Three tabs, split by what each one *belongs* to rather than by what looks
 * balanced: the workspace (shared, and only an owner may change it), the person
 * (yours alone), and the appearance (this browser only, and never synced —
 * a device preference is not account data).
 */

export function SettingsPage() {
  const user = useCurrentUser()
  const { workspace } = useActiveWorkspace()
  const canManage = workspace?.role === WorkspaceRole.Owner

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header>
        <h1 className="text-h1 text-foreground">Settings</h1>
        <p className="mt-1 text-body text-foreground-muted">
          Workspace details, your profile, and how StreamSync looks.
        </p>
      </header>

      <Tabs defaultValue="workspace" className="mt-6" activation="manual">
        <TabsList label="Settings sections">
          <Tab value="workspace">Workspace</Tab>
          <Tab value="profile">Profile</Tab>
          <Tab value="appearance">Appearance</Tab>
        </TabsList>

        <TabPanel value="workspace">
          {workspace ? (
            <WorkspaceSettings
              workspaceId={workspace.id}
              name={workspace.name}
              description={workspace.description}
              slug={workspace.slug}
              createdAt={workspace.createdAt}
              canManage={canManage}
            />
          ) : null}
        </TabPanel>

        <TabPanel value="profile">
          <ProfileSettings name={user.name} email={user.email} title={user.title} />
        </TabPanel>

        <TabPanel value="appearance">
          <AppearanceSettings />
        </TabPanel>
      </Tabs>
    </div>
  )
}

/* -----------------------------------------------------------------------------
 * Workspace
 * -------------------------------------------------------------------------- */

interface WorkspaceSettingsProps {
  workspaceId: string
  name: string
  description: string | null
  slug: string
  createdAt: string
  canManage: boolean
}

function WorkspaceSettings({
  workspaceId,
  name,
  description,
  slug,
  createdAt,
  canManage,
}: WorkspaceSettingsProps) {
  const update = useUpdateWorkspace(workspaceId)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(updateWorkspaceSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { name, description: description ?? '' },
  })

  /* Switching workspace re-renders this form with different props but the same
     component instance, so the fields have to be re-seeded — otherwise the
     previous workspace's name stays in the inputs. */
  useEffect(() => {
    reset({ name, description: description ?? '' })
  }, [reset, name, description, workspaceId])

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await update.mutateAsync(values)
      reset({ name: updated.name, description: updated.description ?? '' })
    } catch (error) {
      applyFieldErrors(error, setError, ['name', 'description'])
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-4">
      {!canManage ? (
        <Alert variant="info">
          Only an owner can change these. You can still see how the workspace is set up.
        </Alert>
      ) : null}

      <Input
        label="Workspace name"
        required
        disabled={!canManage}
        error={errors.name?.message}
        {...register('name')}
      />

      <Textarea
        label="Description"
        rows={3}
        hint="Optional — shown on the workspace overview."
        disabled={!canManage}
        error={errors.description?.message}
        {...register('description')}
      />

      <dl className="grid gap-3 rounded-lg border border-border bg-surface-muted p-3 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-foreground-subtle">URL slug</dt>
          {/* Read-only on purpose: the slug is in every link anyone has shared,
              and renaming a workspace must not break them. */}
          <dd className="mt-0.5 font-mono text-small text-foreground">{slug}</dd>
        </div>
        <div>
          <dt className="text-caption text-foreground-subtle">Created</dt>
          <dd className="mt-0.5 text-small text-foreground">
            <time dateTime={createdAt}>{formatAbsoluteTime(createdAt)}</time>
          </dd>
        </div>
      </dl>

      {canManage ? (
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Saving"
            // Nothing to save is not an error, so the button says so by being
            // inert rather than by raising a toast that says "no changes".
            disabled={!isDirty}
          >
            Save changes
          </Button>
          {isDirty ? (
            <Button variant="ghost" onClick={() => reset()} disabled={isSubmitting}>
              Discard
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

/* -----------------------------------------------------------------------------
 * Profile
 * -------------------------------------------------------------------------- */

function ProfileSettings({
  name,
  email,
  title,
}: {
  name: string
  email: string
  title: string | null
}) {
  return (
    <div className="flex max-w-xl flex-col gap-4">
      {/* Read-only, and it says why. Editing a profile needs an endpoint §80
          does not define, and a form that silently discards what you typed is
          worse than one that is honest about not being wired up. (Rule 10) */}
      <Alert variant="info">
        Profile editing arrives with the Django account endpoints. These values come from your
        session.
      </Alert>

      <Input label="Name" value={name} readOnly disabled />
      <Input label="Email" value={email} type="email" readOnly disabled />
      <Input
        label="Job title"
        value={title ?? '—'}
        readOnly
        disabled
        hint="Shown next to your name in the workspace roster."
      />
    </div>
  )
}

/* -----------------------------------------------------------------------------
 * Appearance
 * -------------------------------------------------------------------------- */

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

function AppearanceSettings() {
  const { preference, resolved, setPreference } = useTheme()

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {/* A radiogroup, not three toggle buttons: these are mutually exclusive
          choices of one value, and the pattern gives arrow-key selection for
          free. (§19) */}
      <fieldset>
        <legend className="text-small font-medium text-foreground">Theme</legend>
        <p className="mt-0.5 text-caption text-foreground-muted">
          Stored in this browser only — it is a device preference, not account data.
        </p>

        <div role="radiogroup" aria-label="Theme" className="mt-3 grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = preference === value

            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreference(value as ThemePreference)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-4',
                  'transition-[border-color,background-color] duration-(--duration-fast)',
                  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                  'focus-visible:ring-offset-background',
                  selected
                    ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
                    : 'border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="text-body font-medium">{label}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <p className="text-caption text-foreground-subtle">
        Currently showing the {resolved} theme.
      </p>
    </div>
  )
}
