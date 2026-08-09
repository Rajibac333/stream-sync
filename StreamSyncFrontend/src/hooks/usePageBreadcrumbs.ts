import { useEffect, useMemo } from 'react'

import { useUiStore, type BreadcrumbCrumb } from '@/store/uiStore'

/**
 * Publishes a breadcrumb trail from a page to the shell's topbar.
 *
 * The shell derives breadcrumbs from the URL, which is all it can know — a path
 * carries a document's *id*, not its title. A page that has loaded the record
 * calls this and the topbar shows "Payment Requirements" instead of "Document".
 *
 * The trail is cleared on unmount, so navigating away can never leave the
 * previous page's breadcrumb behind.
 */
export function usePageBreadcrumbs(trail: readonly BreadcrumbCrumb[] | null): void {
  const setBreadcrumbTrail = useUiStore((state) => state.setBreadcrumbTrail)

  /* Callers build the array inline, so it is a new reference every render.
     Keying the effect on the serialised value means it fires when the trail's
     *content* changes rather than on every parent render — which for the
     editor is once per keystroke. */
  const serialized = useMemo(() => JSON.stringify(trail), [trail])

  useEffect(() => {
    setBreadcrumbTrail(serialized === null ? null : (JSON.parse(serialized) as BreadcrumbCrumb[]))
    return () => setBreadcrumbTrail(null)
  }, [serialized, setBreadcrumbTrail])
}
