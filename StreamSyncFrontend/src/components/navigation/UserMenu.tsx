import { LogOut, Settings, User as UserIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Avatar } from '@/components/ui/Avatar'
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
} from '@/components/ui/Dropdown'
import { routes } from '@/constants/routes'
import { useCurrentUser, useLogout } from '@/hooks/useAuth'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { toast } from '@/store/toastStore'

/**
 * Profile menu. (CLAUDE.md §29)
 *
 * Signing out is the one genuinely destructive action in the shell, so it is
 * separated by a rule and styled as such — but it is not behind a confirmation
 * dialog, because signing back in is cheap and a confirmation on every sign-out
 * is the kind of friction that trains people to click through dialogs.
 */
export function UserMenu() {
  const user = useCurrentUser()
  const logout = useLogout()
  const navigate = useNavigate()
  const { workspace } = useActiveWorkspace()

  const handleSignOut = async () => {
    // The mutation clears the session and the query cache even if the network
    // call fails, so this path does not need its own error branch.
    await logout.mutateAsync()
    navigate(routes.auth.login, { replace: true })
    toast.show({ title: 'Signed out', description: 'See you next time.' })
  }

  return (
    <Dropdown
      align="end"
      label="Account"
      className="w-60"
      trigger={
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar name={user.name} userId={user.id} src={user.avatarUrl} size="md" />
        </button>
      }
    >
      {/* Identity header — not a menu item, so it is not focusable and does not
          get caught in arrow-key navigation. */}
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar name={user.name} userId={user.id} src={user.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-foreground">{user.name}</p>
          <p className="truncate text-caption text-foreground-muted">{user.email}</p>
        </div>
      </div>

      <DropdownSeparator />

      <DropdownItem
        icon={<UserIcon aria-hidden="true" />}
        onClick={() =>
          toast.show({
            title: "Profile settings aren’t built yet",
            description: 'Account settings are not scheduled into a milestone yet.',
          })
        }
      >
        Profile
      </DropdownItem>

      <DropdownItem
        icon={<Settings aria-hidden="true" />}
        disabled={!workspace}
        onClick={() => {
          if (workspace) navigate(routes.workspace.settings(workspace.id))
        }}
      >
        Workspace settings
      </DropdownItem>

      <DropdownSeparator />

      <DropdownItem
        variant="danger"
        icon={<LogOut aria-hidden="true" />}
        onClick={() => void handleSignOut()}
      >
        Sign out
      </DropdownItem>
    </Dropdown>
  )
}
