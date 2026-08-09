import { FileText, FolderKanban, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ActivityFeed, ActivityFeedSkeleton } from '@/components/activity/ActivityFeed'
import { DocumentRow, DocumentRowSkeleton } from '@/components/documents/DocumentRow'
import { FadeIn } from '@/components/layout/FadeIn'
import { Section } from '@/components/layout/Section'
import { ProjectCard, ProjectCardSkeleton } from '@/components/projects/ProjectCard'
import { MemberList, PersonListSkeleton } from '@/components/workspace/MemberList'
import { QuickActions } from '@/components/workspace/QuickActions'
import { AvatarGroup } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { buttonVariants } from '@/components/ui/Button.variants'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { QueryState } from '@/components/ui/QueryState'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/constants/routes'
import { useActiveWorkspace } from '@/hooks/useWorkspaces'
import {
  useActivity,
  useDocuments,
  useMembers,
  useProjects,
} from '@/hooks/useWorkspaceContent'

/**
 * Workspace overview. (CLAUDE.md §28, §32)
 *
 * The dashboard answers "what should I do today"; this answers "what is this
 * workspace". Hence the ordering — identity and quick actions first, then the
 * inventory of projects and documents, with the roster and history in the rail.
 */
export function WorkspacePage() {
  const { workspace, workspaces, isLoading } = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null

  const projectsQuery = useProjects(workspaceId)
  const documentsQuery = useDocuments(workspaceId)
  const membersQuery = useMembers(workspaceId)
  const activityQuery = useActivity(workspaceId)

  /* The URL named a workspace this user cannot see — a shared link to someone
     else's workspace, or one they were removed from. Said plainly rather than
     silently falling back to a different workspace. */
  if (!isLoading && !workspace) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-24">
        <ErrorState
          title="Workspace not available"
          description={
            workspaces.length > 0
              ? "This workspace doesn't exist, or you don't have access to it."
              : "You're not a member of any workspace yet."
          }
          action={
            <Link to={routes.app.dashboard} className={buttonVariants({ variant: 'secondary' })}>
              Go to dashboard
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* -----------------------------------------------------------------
          Identity
         ----------------------------------------------------------------- */}
      <FadeIn>
        <header>
          {isLoading || !workspace ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only" role="status">
                Loading workspace
              </span>
              <Skeleton shape="text" className="h-8 w-56" />
              <Skeleton shape="text" className="h-4 w-80 max-w-full" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-h1 text-foreground">{workspace.name}</h1>
                <Badge variant="outline" className="capitalize">
                  {workspace.role}
                </Badge>
              </div>

              {workspace.description ? (
                <p className="mt-2 max-w-2xl text-body text-foreground-muted">
                  {workspace.description}
                </p>
              ) : null}

              <div className="mt-4 flex items-center gap-3">
                <QueryState
                  query={membersQuery}
                  errorTitle="Couldn't load members"
                  loading={<Skeleton shape="circle" className="size-6" />}
                  empty={<span className="text-caption text-foreground-subtle">No members</span>}
                >
                  {(members) => (
                    <>
                      <AvatarGroup
                        users={members.map((member) => member.user)}
                        max={5}
                        size="sm"
                      />
                      <Link
                        to={routes.workspace.members(workspace.id)}
                        className="rounded-sm text-caption text-foreground-muted outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        {members.length} {members.length === 1 ? 'member' : 'members'}
                      </Link>
                    </>
                  )}
                </QueryState>
              </div>
            </>
          )}
        </header>
      </FadeIn>

      <FadeIn index={1} className="mt-6">
        <h2 className="sr-only">Quick actions</h2>
        <QuickActions />
      </FadeIn>

      <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---------------------------------------------------------------
            Inventory
           --------------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-8 lg:gap-10">
          <FadeIn index={2}>
            <Section
              title="Projects"
              {...(workspaceId ? { href: routes.workspace.projects(workspaceId) } : {})}
              linkLabel="All projects"
            >
              <QueryState
                query={projectsQuery}
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
                    title="No projects yet"
                    description="Create your first project to group work and track progress."
                  />
                }
              >
                {(projects) => (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {projects.slice(0, 4).map((project) => (
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
                    {documents.slice(0, 6).map((document) => (
                      <DocumentRow key={document.id} document={document} />
                    ))}
                  </ul>
                )}
              </QueryState>
            </Section>
          </FadeIn>
        </div>

        {/* ---------------------------------------------------------------
            Rail
           --------------------------------------------------------------- */}
        <aside className="flex min-w-0 flex-col gap-8 lg:gap-10" aria-label="Workspace details">
          <FadeIn index={4}>
            <Section
              title="Members"
              {...(workspaceId ? { href: routes.workspace.members(workspaceId) } : {})}
              linkLabel="Manage"
              boxed
            >
              <QueryState
                query={membersQuery}
                errorTitle="Couldn't load members"
                loading={<PersonListSkeleton rows={4} />}
                empty={
                  <EmptyState
                    size="inline"
                    icon={<Users />}
                    title="No members yet"
                    description="Invite teammates to start collaborating."
                  />
                }
              >
                {(members) => <MemberList members={members} />}
              </QueryState>
            </Section>
          </FadeIn>

          <FadeIn index={5}>
            <Section
              title="Activity"
              {...(workspaceId ? { href: routes.workspace.activity(workspaceId) } : {})}
            >
              <QueryState
                query={activityQuery}
                errorTitle="Couldn't load activity"
                loading={<ActivityFeedSkeleton rows={5} />}
                empty={
                  <EmptyState
                    size="inline"
                    title="No activity yet"
                    description="Edits, comments and completed tasks show up here."
                  />
                }
              >
                {(events) => <ActivityFeed events={events.slice(0, 7)} />}
              </QueryState>
            </Section>
          </FadeIn>
        </aside>
      </div>
    </div>
  )
}
