import { CalendarClock, CircleCheckBig, FileText, FolderKanban, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ActivityFeed, ActivityFeedSkeleton } from '@/components/activity/ActivityFeed'
import { GreetingHeader } from '@/components/dashboard/GreetingHeader'
import { FadeIn } from '@/components/layout/FadeIn'
import { Section } from '@/components/layout/Section'
import { DocumentRow, DocumentRowSkeleton } from '@/components/documents/DocumentRow'
import { ProjectCard, ProjectCardSkeleton } from '@/components/projects/ProjectCard'
import { TaskRow, TaskRowSkeleton } from '@/components/tasks/TaskRow'
import { CollaboratorList, PersonListSkeleton } from '@/components/workspace/MemberList'
import { buttonVariants } from '@/components/ui/Button.variants'
import { EmptyState } from '@/components/ui/EmptyState'
import { QueryState } from '@/components/ui/QueryState'
import { routes } from '@/constants/routes'
import { useCurrentUser } from '@/hooks/useAuth'
import { InvitationList } from '@/components/workspace/InvitationList'
import { useActiveWorkspace, usePendingInvitations } from '@/hooks/useWorkspaces'
import { useUiStore } from '@/store/uiStore'
import {
  selectActiveProjects,
  selectDueToday,
  selectUpcomingDeadlines,
  useActivity,
  useDashboardSummary,
  useDocuments,
  useProjects,
  useTasks,
} from '@/hooks/useWorkspaceContent'
import { todayIso } from '@/utils/format'

/**
 * Dashboard. (CLAUDE.md §31)
 *
 * The layout encodes a priority order rather than treating every section as
 * equal:
 *
 *   header   what today looks like, in one sentence and four figures
 *   primary  the work itself — due today, active projects, recent documents
 *   rail     context you glance at — deadlines, who is around, what happened
 *
 * The rail drops below the primary column under `lg`, so on a phone the first
 * thing on screen is still the work rather than a list of collaborators. (§18)
 *
 * Tasks, projects and documents are each fetched once and sliced by the pure
 * selectors in useWorkspaceContent — "due today" and "upcoming" are two views
 * of one cached list, not two requests. (§64)
 */
export function DashboardPage() {
  const user = useCurrentUser()
  const { workspace, workspaces, isLoading } = useActiveWorkspace()
  const openCreateDialog = useUiStore((state) => state.openCreateDialog)
  const invitations = usePendingInvitations().data ?? []
  const workspaceId = workspace?.id ?? null
  const today = todayIso()

  const summaryQuery = useDashboardSummary(workspaceId)
  const tasksQuery = useTasks(workspaceId)
  const projectsQuery = useProjects(workspaceId)
  const documentsQuery = useDocuments(workspaceId)
  const activityQuery = useActivity(workspaceId)

  const firstName = user.name.split(' ')[0] ?? user.name

  /* A new account belongs to no workspace, and every query on this page is
     scoped to one — so without this the screen sits on skeletons that will
     never resolve, which reads as "broken" rather than "nothing here yet".
     The mock data seeds a workspace, so this state only ever appears against
     the real API. (§60) */
  if (!isLoading && workspaces.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <FadeIn>
          {/* The h1 stays on the page. EmptyState's title is an h3, so relying
              on it alone would leave the dashboard with no top-level heading —
              a screen reader would announce a page that never says what it is. */}
          <h1 className="text-h1 text-foreground">Welcome to StreamSync, {firstName}</h1>

          {/* An invited teammate lands here with no workspaces of their own.
              Accepting is the way in, and it has to be on this screen — the
              switcher cannot show a workspace they have not joined. */}
          {invitations.length > 0 ? (
            <div className="mt-6">
              <InvitationList invitations={invitations} />
            </div>
          ) : null}

          <EmptyState
            icon={<FolderKanban aria-hidden="true" />}
            title="Create your first workspace"
            description="Workspaces hold your projects, documents and tasks. You can invite your team once one exists."
            action={
              <button
                type="button"
                className={buttonVariants({ variant: 'primary' })}
                onClick={() => openCreateDialog({ kind: 'workspace' })}
              >
                Create workspace
              </button>
            }
          />
        </FadeIn>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <FadeIn>
        <GreetingHeader firstName={firstName} workspaceId={workspaceId} query={summaryQuery} />
      </FadeIn>

      {invitations.length > 0 ? (
        <FadeIn>
          <div className="mt-6">
            <InvitationList invitations={invitations} />
          </div>
        </FadeIn>
      ) : null}

      <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---------------------------------------------------------------
            Primary column — the work
           --------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-8 lg:gap-10">
          <FadeIn index={1}>
            <Section
              title="Today"
              description="Due today or overdue"
              {...(workspaceId ? { href: routes.workspace.tasks(workspaceId) } : {})}
              linkLabel="All tasks"
              boxed
            >
              <QueryState
                query={tasksQuery}
                isEmpty={(tasks) => selectDueToday(tasks, today).length === 0}
                errorTitle="Couldn't load today's tasks"
                loading={
                  <ul aria-busy="true">
                    <span className="sr-only" role="status">
                      Loading tasks
                    </span>
                    <TaskRowSkeleton />
                    <TaskRowSkeleton />
                    <TaskRowSkeleton />
                  </ul>
                }
                empty={
                  <EmptyState
                    size="inline"
                    icon={<CircleCheckBig />}
                    title="Nothing due today"
                    description="No open tasks are dated for today. Upcoming work is in the rail."
                  />
                }
              >
                {(tasks) => (
                  <ul>
                    {selectDueToday(tasks, today).map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </ul>
                )}
              </QueryState>
            </Section>
          </FadeIn>

          <FadeIn index={2}>
            <Section
              title="Active projects"
              {...(workspaceId ? { href: routes.workspace.projects(workspaceId) } : {})}
              linkLabel="All projects"
            >
              <QueryState
                query={projectsQuery}
                isEmpty={(projects) => selectActiveProjects(projects).length === 0}
                errorTitle="Couldn't load projects"
                loading={
                  <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
                    <span className="sr-only" role="status">
                      Loading projects
                    </span>
                    <ProjectCardSkeleton />
                    <ProjectCardSkeleton />
                  </div>
                }
                empty={
                  <EmptyState
                    size="inline"
                    icon={<FolderKanban />}
                    title="No active projects"
                    description="Create a project to group work and track progress against it."
                    action={
                      workspaceId ? (
                        <Link
                          to={routes.workspace.projects(workspaceId)}
                          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        >
                          Go to projects
                        </Link>
                      ) : null
                    }
                  />
                }
              >
                {(projects) => (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectActiveProjects(projects).map((project) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </div>
                )}
              </QueryState>
            </Section>
          </FadeIn>

          <FadeIn index={3}>
            <Section
              title="Recent documents"
              {...(workspaceId ? { href: routes.workspace.documents(workspaceId) } : {})}
              linkLabel="All documents"
              boxed
            >
              <QueryState
                query={documentsQuery}
                errorTitle="Couldn't load documents"
                loading={
                  <ul aria-busy="true">
                    <span className="sr-only" role="status">
                      Loading documents
                    </span>
                    <DocumentRowSkeleton />
                    <DocumentRowSkeleton />
                    <DocumentRowSkeleton />
                  </ul>
                }
                empty={
                  <EmptyState
                    size="inline"
                    icon={<FileText />}
                    title="No documents yet"
                    description="Create your first document and start collaborating."
                  />
                }
              >
                {(documents) => (
                  <ul>
                    {documents.slice(0, 5).map((document) => (
                      <DocumentRow key={document.id} document={document} />
                    ))}
                  </ul>
                )}
              </QueryState>
            </Section>
          </FadeIn>
        </div>

        {/* ---------------------------------------------------------------
            Rail — context
           --------------------------------------------------------------- */}
        <aside className="flex min-w-0 flex-col gap-8 lg:gap-10" aria-label="Workspace context">
          <FadeIn index={4}>
            <Section title="Upcoming deadlines" boxed>
              <QueryState
                query={tasksQuery}
                isEmpty={(tasks) => selectUpcomingDeadlines(tasks, today).length === 0}
                errorTitle="Couldn't load deadlines"
                loading={
                  <ul aria-busy="true">
                    <TaskRowSkeleton />
                    <TaskRowSkeleton />
                  </ul>
                }
                empty={
                  <EmptyState
                    size="inline"
                    icon={<CalendarClock />}
                    title="Nothing scheduled"
                    description="Dated tasks appear here as they are created."
                  />
                }
              >
                {(tasks) => (
                  <ul>
                    {selectUpcomingDeadlines(tasks, today).map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </ul>
                )}
              </QueryState>
            </Section>
          </FadeIn>

          <FadeIn index={5}>
            <Section title="Active now" boxed>
              <QueryState
                query={summaryQuery}
                isEmpty={(summary) => summary.collaborators.length === 0}
                errorTitle="Couldn't load collaborators"
                loading={<PersonListSkeleton rows={3} />}
                empty={
                  <EmptyState
                    size="inline"
                    icon={<Users />}
                    title="Nobody else is here"
                    description="Teammates show up here while they're working."
                  />
                }
              >
                {(summary) => <CollaboratorList collaborators={summary.collaborators} />}
              </QueryState>
            </Section>
          </FadeIn>

          <FadeIn index={6}>
            <Section
              title="Recent activity"
              {...(workspaceId ? { href: routes.workspace.activity(workspaceId) } : {})}
            >
              <QueryState
                query={activityQuery}
                errorTitle="Couldn't load activity"
                loading={<ActivityFeedSkeleton rows={4} />}
                empty={
                  <EmptyState
                    size="inline"
                    title="No activity yet"
                    description="Edits, comments and completed tasks show up here."
                  />
                }
              >
                {(events) => <ActivityFeed events={events.slice(0, 6)} />}
              </QueryState>
            </Section>
          </FadeIn>
        </aside>
      </div>
    </div>
  )
}
