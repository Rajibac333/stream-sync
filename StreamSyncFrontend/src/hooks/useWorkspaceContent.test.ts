import { describe, expect, it } from 'vitest'

import {
  selectActiveProjects,
  selectDueToday,
  selectMyTasks,
  selectOpenTasks,
  selectUpcomingDeadlines,
} from '@/hooks/useWorkspaceContent'
import { ProjectStatus, type Project } from '@/types/project'
import { TaskStatus, type Task } from '@/types/task'
import { todayIso } from '@/utils/format'

/**
 * Dashboard selectors. (CLAUDE.md §31)
 *
 * The invariant these exist to protect: a headline figure and the list beneath
 * it must describe the same set. A dashboard whose badge says 3 above a list of
 * 4 is worse than one with no badge — it teaches the user not to trust either.
 */

const TODAY = todayIso()
const ws = 'wsp-test'

function task(overrides: Partial<Task>): Task {
  return {
    id: 'tsk-x',
    workspaceId: ws,
    projectId: 'prj-x',
    projectName: 'Project X',
    title: 'A task',
    description: null,
    status: TaskStatus.Todo,
    priority: 'medium',
    assignee: null,
    dueDate: null,
    labels: [],
    commentCount: 0,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** `YYYY-MM-DD`, `offset` days from today. */
function day(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('selectOpenTasks', () => {
  it('excludes done tasks and nothing else', () => {
    const tasks = [
      task({ id: 'a', status: TaskStatus.Todo }),
      task({ id: 'b', status: TaskStatus.InProgress }),
      task({ id: 'c', status: TaskStatus.Review }),
      task({ id: 'd', status: TaskStatus.Done }),
    ]
    expect(selectOpenTasks(tasks).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('tolerates undefined while a query is still pending', () => {
    expect(selectOpenTasks(undefined)).toEqual([])
  })
})

describe('selectDueToday', () => {
  it('includes overdue work — it is still owed', () => {
    const tasks = [
      task({ id: 'overdue', dueDate: day(-3) }),
      task({ id: 'today', dueDate: TODAY }),
      task({ id: 'tomorrow', dueDate: day(1) }),
      task({ id: 'undated', dueDate: null }),
    ]
    expect(selectDueToday(tasks, TODAY).map((entry) => entry.id)).toEqual(['overdue', 'today'])
  })

  it('puts the most overdue first', () => {
    const tasks = [
      task({ id: 'today', dueDate: TODAY }),
      task({ id: 'week-late', dueDate: day(-7) }),
      task({ id: 'day-late', dueDate: day(-1) }),
    ]
    expect(selectDueToday(tasks, TODAY).map((entry) => entry.id)).toEqual([
      'week-late',
      'day-late',
      'today',
    ])
  })

  it('never includes a completed task, however overdue', () => {
    const tasks = [task({ id: 'done', dueDate: day(-5), status: TaskStatus.Done })]
    expect(selectDueToday(tasks, TODAY)).toEqual([])
  })
})

describe('selectUpcomingDeadlines', () => {
  it('covers only future dated work, soonest first', () => {
    const tasks = [
      task({ id: 'far', dueDate: day(9) }),
      task({ id: 'today', dueDate: TODAY }),
      task({ id: 'near', dueDate: day(2) }),
      task({ id: 'overdue', dueDate: day(-1) }),
      task({ id: 'undated', dueDate: null }),
    ]
    expect(selectUpcomingDeadlines(tasks, TODAY).map((entry) => entry.id)).toEqual(['near', 'far'])
  })

  it('does not overlap with the Today list — each task appears in one place', () => {
    const tasks = [
      task({ id: 'overdue', dueDate: day(-2) }),
      task({ id: 'today', dueDate: TODAY }),
      task({ id: 'soon', dueDate: day(3) }),
    ]

    const todayIds = new Set(selectDueToday(tasks, TODAY).map((entry) => entry.id))
    const upcomingIds = selectUpcomingDeadlines(tasks, TODAY).map((entry) => entry.id)

    expect(upcomingIds.some((id) => todayIds.has(id))).toBe(false)
  })

  it('respects the limit', () => {
    const tasks = Array.from({ length: 9 }, (_, index) =>
      task({ id: `t${index}`, dueDate: day(index + 1) }),
    )
    expect(selectUpcomingDeadlines(tasks, TODAY, 4)).toHaveLength(4)
  })
})

describe('selectMyTasks', () => {
  it('returns only the user’s open work, most urgent first', () => {
    const me = { id: 'usr-me', name: 'Me', avatarUrl: null }
    const tasks = [
      task({ id: 'low', assignee: me, priority: 'low' }),
      task({ id: 'urgent', assignee: me, priority: 'urgent' }),
      task({ id: 'someone-else', assignee: { id: 'usr-other', name: 'Other', avatarUrl: null } }),
      task({ id: 'mine-done', assignee: me, status: TaskStatus.Done }),
    ]
    expect(selectMyTasks(tasks, 'usr-me').map((entry) => entry.id)).toEqual(['urgent', 'low'])
  })
})

function project(overrides: Partial<Project>): Project {
  return {
    id: 'prj-x',
    workspaceId: ws,
    name: 'Project X',
    description: null,
    status: ProjectStatus.Active,
    taskCount: 0,
    completedTaskCount: 0,
    dueDate: null,
    members: [],
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('selectActiveProjects', () => {
  it('excludes planning, on-hold and completed projects', () => {
    const projects = [
      project({ id: 'a', status: ProjectStatus.Active }),
      project({ id: 'b', status: ProjectStatus.Planning }),
      project({ id: 'c', status: ProjectStatus.OnHold }),
      project({ id: 'd', status: ProjectStatus.Completed }),
    ]

    expect(selectActiveProjects(projects).map((entry) => entry.id)).toEqual(['a'])
  })
})

/*
 * The dashboard's headline figures used to be cross-checked here, against the
 * mock service that produced both the counts and the lists. They are now
 * computed by the server — a client cannot count a paginated collection
 * correctly — so that invariant is asserted where the arithmetic happens:
 * StreamSyncBackend/tests/dashboard/test_dashboard_api.py.
 */
