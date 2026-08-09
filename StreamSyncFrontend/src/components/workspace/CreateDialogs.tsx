import { DocumentFormDialog } from '@/components/documents/DocumentFormDialog'
import { ProjectFormDialog } from '@/components/projects/ProjectFormDialog'
import { TaskFormDialog } from '@/components/tasks/TaskFormDialog'
import { WorkspaceFormDialog } from '@/components/workspace/WorkspaceFormDialog'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'

/**
 * The creation dialogs, mounted once for the whole application.
 *
 * Four surfaces open these — the command menu, the workspace quick actions,
 * each page header, and every Kanban column's "+" — and they live in different
 * parts of the tree. Holding the open/closed state per page meant the global
 * ones had nothing to call, which is why they sat on "arrives in Milestone 4"
 * toasts after the dialogs had actually shipped. One host, one state, in the
 * UI store where transient chrome state belongs. (CLAUDE.md §53)
 *
 * Each dialog is rendered only while it is the active one, so an unopened
 * dialog runs no queries — the task dialog alone would otherwise fetch
 * projects, members and labels on every page.
 */
export function CreateDialogs() {
  const createDialog = useUiStore((state) => state.createDialog)
  const closeCreateDialog = useUiStore((state) => state.closeCreateDialog)
  const { workspace } = useActiveWorkspace()

  const close = () => closeCreateDialog()

  if (createDialog?.kind === 'workspace') {
    return <WorkspaceFormDialog open onOpenChange={close} />
  }

  // Everything below is workspace-scoped; without one there is nothing to
  // create into. The entry points disable themselves in that state too.
  if (!workspace) return null

  switch (createDialog?.kind) {
    case 'project':
      return <ProjectFormDialog open onOpenChange={close} workspaceId={workspace.id} />

    case 'document':
      return (
        <DocumentFormDialog
          open
          onOpenChange={close}
          workspaceId={workspace.id}
          {...(createDialog.projectId ? { defaultProjectId: createDialog.projectId } : {})}
        />
      )

    case 'task':
      return (
        <TaskFormDialog
          open
          onOpenChange={close}
          workspaceId={workspace.id}
          {...(createDialog.projectId ? { defaultProjectId: createDialog.projectId } : {})}
          {...(createDialog.status ? { defaultStatus: createDialog.status } : {})}
        />
      )

    default:
      return null
  }
}
