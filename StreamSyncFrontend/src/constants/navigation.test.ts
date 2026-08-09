import { describe, expect, it } from 'vitest'

import { isNavItemActive, primaryNavigation, secondaryNavigation } from '@/constants/navigation'

/**
 * Sidebar active-state matching. (CLAUDE.md §27)
 *
 * Worth testing because the failure mode is silent: a prefix rule that is
 * slightly too loose highlights two sections at once, and one that is too tight
 * un-highlights the section you are standing in.
 */

const allItems = [...primaryNavigation, ...secondaryNavigation]
const item = (id: string) => {
  const found = allItems.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`No nav item "${id}"`)
  return found
}

const WORKSPACE = 'evertech'

describe('isNavItemActive', () => {
  it('highlights a section from one of its child routes', () => {
    expect(
      isNavItemActive(item('projects'), '/app/workspaces/evertech/projects/prj-1', WORKSPACE),
    ).toBe(true)
  })

  it('highlights a section from the section root', () => {
    expect(isNavItemActive(item('projects'), '/app/workspaces/evertech/projects', WORKSPACE)).toBe(
      true,
    )
  })

  it('does not leak across sibling sections', () => {
    expect(isNavItemActive(item('projects'), '/app/workspaces/evertech/documents', WORKSPACE)).toBe(
      false,
    )
  })

  it('does not match a different workspace', () => {
    expect(
      isNavItemActive(item('projects'), '/app/workspaces/northwind/projects', WORKSPACE),
    ).toBe(false)
  })

  it('matches the dashboard exactly and nothing beneath it', () => {
    expect(isNavItemActive(item('dashboard'), '/app/dashboard', WORKSPACE)).toBe(true)
    expect(isNavItemActive(item('dashboard'), '/app/dashboard/anything', WORKSPACE)).toBe(false)
  })

  it('highlights exactly one section for any workspace route', () => {
    const paths = [
      '/app/dashboard',
      '/app/workspaces/evertech/projects',
      '/app/workspaces/evertech/documents/doc-1',
      '/app/workspaces/evertech/tasks',
      '/app/workspaces/evertech/activity',
      '/app/workspaces/evertech/members',
      '/app/workspaces/evertech/settings',
    ]

    for (const path of paths) {
      const active = allItems.filter((candidate) => isNavItemActive(candidate, path, WORKSPACE))
      expect(active.map((candidate) => candidate.id), `for ${path}`).toHaveLength(1)
    }
  })
})

describe('navigation config', () => {
  it('has unique ids — they are used as React keys and command-menu ids', () => {
    const ids = allItems.map((candidate) => candidate.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('scopes everything except the dashboard to a workspace', () => {
    for (const candidate of allItems) {
      expect(candidate.requiresWorkspace, candidate.id).toBe(candidate.id !== 'dashboard')
    }
  })

  it('builds paths inside the workspace it was given', () => {
    for (const candidate of allItems.filter((entry) => entry.requiresWorkspace)) {
      expect(candidate.to(WORKSPACE), candidate.id).toContain(`/app/workspaces/${WORKSPACE}/`)
    }
  })
})
