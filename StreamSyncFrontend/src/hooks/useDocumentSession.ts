import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { documentsApi } from '@/api/documents'
import { queryKeys } from '@/api/queryKeys'
import { useCurrentUser } from '@/hooks/useAuth'
import type {
  DocumentDetail,
  DocumentShareEntry,
  DocumentVersion,
} from '@/types/document'
import { acquireDocumentSession } from '@/websocket/connectionRegistry'
import type { DocumentSession, DocumentSessionState } from '@/websocket/documentSync'
import {
  ConnectionState,
  SyncState,
  type CursorPosition,
} from '@/websocket/types'

/**
 * The editor's only door to the real-time layer. (CLAUDE.md §54, Rule 8)
 *
 * Components render `state` and call `pushContent` / `pushCursor`. They never
 * import the socket client, never see a frame, and never learn whether the
 * bytes came from Django Channels or from the in-process mock server. That is
 * the isolation Rule 8 asks for, and it is what makes the transport swappable.
 */

export function useDocumentDetail(documentId: string | undefined): UseQueryResult<DocumentDetail> {
  return useQuery({
    queryKey: queryKeys.documents.detail(documentId ?? ''),
    queryFn: () => documentsApi.get(documentId ?? ''),
    enabled: Boolean(documentId),
    // The socket owns freshness once connected; refetching on focus would
    // stomp the live document with a REST snapshot.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
}

export function useDocumentVersions(
  documentId: string | undefined,
  enabled = true,
): UseQueryResult<DocumentVersion[]> {
  return useQuery({
    queryKey: queryKeys.documents.versions(documentId ?? ''),
    queryFn: () => documentsApi.versions(documentId ?? ''),
    // Only fetched when the panel is actually open — history is a click away,
    // not something every reader should pay for.
    enabled: Boolean(documentId) && enabled,
    staleTime: 60_000,
  })
}

export function useDocumentShares(
  documentId: string | undefined,
  enabled = true,
): UseQueryResult<DocumentShareEntry[]> {
  return useQuery({
    queryKey: queryKeys.documents.shares(documentId ?? ''),
    queryFn: () => documentsApi.shares(documentId ?? ''),
    enabled: Boolean(documentId) && enabled,
    staleTime: 60_000,
  })
}

/* -----------------------------------------------------------------------------
 * Live session
 * -------------------------------------------------------------------------- */

export interface UseDocumentSessionResult {
  state: DocumentSessionState
  pushContent: (content: string) => void
  pushCursor: (cursor: CursorPosition) => void
  flush: () => void
  /** Remote content the editor has not applied yet, if any. */
  remoteContent: { content: string; revision: number } | null
  acknowledgeRemote: () => void
}

const IDLE_STATE: DocumentSessionState = {
  connection: ConnectionState.Connecting,
  sync: SyncState.Synced,
  participants: new Map(),
  serverContent: null,
  revision: 0,
  lastSavedAt: null,
  error: null,
  hasRemoteUpdate: false,
  disconnectReason: null,
}

export function useDocumentSession(
  documentId: string | undefined,
  document: DocumentDetail | undefined,
): UseDocumentSessionResult {
  const user = useCurrentUser()
  const [state, setState] = useState<DocumentSessionState>(IDLE_STATE)
  const [remoteContent, setRemoteContent] = useState<{ content: string; revision: number } | null>(
    null,
  )

  // The session is imperative and long-lived; a ref keeps it out of render.
  const sessionRef = useRef<DocumentSession | null>(null)

  useEffect(() => {
    // Wait for the REST fetch: opening a socket before the initial content
    // exists means the first sync frame has nothing to reconcile against.
    if (!documentId || !document) return

    /* Acquired from the registry rather than constructed here. Two mounts of
       this hook — StrictMode's double invocation, or a second component
       wanting presence — share one socket instead of opening two and
       double-joining the document. (§54) */
    const lease = acquireDocumentSession({
      documentId,
      self: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
      initialContent: document.content,
      initialRevision: document.revision,
      onChange: setState,
      onRemoteContent: (content, revision) => setRemoteContent({ content, revision }),
    })

    sessionRef.current = lease.session

    return () => {
      // Releases this holder. The socket is torn down — flushing any debounced
      // edit and sending `document.leave` — only when the last one lets go.
      lease.release()
      sessionRef.current = null
      setState(IDLE_STATE)
      setRemoteContent(null)
    }
  }, [documentId, document, user.id, user.name, user.avatarUrl])

  /* A tab closing mid-debounce should not lose the last thing typed. This is
     best-effort by nature — the browser may kill the page first — which is
     exactly why the debounce is short. */
  useEffect(() => {
    const flushOnHide = () => {
      if (document !== undefined) sessionRef.current?.flush()
    }
    window.addEventListener('pagehide', flushOnHide)
    return () => window.removeEventListener('pagehide', flushOnHide)
  }, [document])

  const pushContent = useCallback((content: string) => {
    sessionRef.current?.pushContent(content)
  }, [])

  const pushCursor = useCallback((cursor: CursorPosition) => {
    sessionRef.current?.pushCursor(cursor)
  }, [])

  const flush = useCallback(() => {
    sessionRef.current?.flush()
  }, [])

  const acknowledgeRemote = useCallback(() => setRemoteContent(null), [])

  return { state, pushContent, pushCursor, flush, remoteContent, acknowledgeRemote }
}
