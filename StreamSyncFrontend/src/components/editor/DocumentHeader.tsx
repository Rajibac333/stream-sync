import {
  Ellipsis,
  History,
  MessageSquare,
  PanelRight,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { CollaboratorAvatars, SaveStatus, TypingIndicator } from '@/components/editor/PresenceBar'
import { Button } from '@/components/ui/Button'
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/Dropdown'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/store/toastStore'
import type { DocumentDetail } from '@/types/document'
import type { ParticipantMap } from '@/websocket/presence'
import type { ConnectionState, DisconnectReason, SyncState } from '@/websocket/types'
import { cn } from '@/utils/cn'
import type { EditorPanel } from '@/components/editor/panels'
import { PANEL_LABELS } from '@/components/editor/panels'

/**
 * Editor header. (CLAUDE.md §34)
 *
 * Everything §34 lists: title, last-saved status, collaborators, Share and a
 * More menu — plus the panel toggles, which belong here because they change
 * what the header's own layout has to make room for.
 *
 * The **breadcrumb lives in the app topbar**, not here. It was in both, which
 * put two breadcrumb trails one above the other, and the upper one read
 * "Document" because the shell only knows the URL. The fix was to teach the
 * shell's breadcrumb to resolve the real title from the query cache and delete
 * the duplicate — one trail, in the place every other screen puts it.
 *
 * Sticky, and deliberately shallow. The header of a writing surface competing
 * with the writing is the most common way these screens go wrong.
 */

export interface DocumentHeaderProps {
  document: DocumentDetail
  participants: ParticipantMap
  selfId: string
  connection: ConnectionState
  sync: SyncState
  lastSavedAt: string | null
  disconnectReason: DisconnectReason | null
  activePanel: EditorPanel | null
  onPanelChange: (panel: EditorPanel | null) => void
  onShare: () => void
}

const PANEL_ICONS = {
  outline: PanelRight,
  comments: MessageSquare,
  history: History,
  ai: Sparkles,
} as const

export function DocumentHeader({
  document,
  participants,
  selfId,
  connection,
  sync,
  lastSavedAt,
  disconnectReason,
  activePanel,
  onPanelChange,
  onShare,
}: DocumentHeaderProps) {
  return (
    <header className="sticky top-topbar z-20 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-2 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {/* The page's heading. The <h1> inside the document body belongs to
                the *content* the user wrote; this one names the screen. */}
            <h1 className="truncate text-h3 text-foreground">{document.title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <CollaboratorAvatars participants={participants} />

            <Button
              variant="secondary"
              size="sm"
              onClick={onShare}
              leadingIcon={<Share2 aria-hidden="true" />}
            >
              Share
            </Button>

            {/* Panel toggles. `aria-pressed` because these are toggles, and
                each names the panel it controls. */}
            <div className="hidden items-center gap-0.5 md:flex">
              {(Object.keys(PANEL_ICONS) as EditorPanel[]).map((panel) => {
                const Icon = PANEL_ICONS[panel]
                const active = activePanel === panel

                return (
                  // This header is `sticky top-0`, so there's no room above it
                  // for the default top-side tooltip — it would render clipped
                  // off the top of the viewport. Bottom is the only side with
                  // space to actually show the label.
                  <Tooltip key={panel} content={PANEL_LABELS[panel]} side="bottom" instant>
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-label={PANEL_LABELS[panel]}
                      onClick={() => onPanelChange(active ? null : panel)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md',
                        'transition-colors duration-(--duration-instant)',
                        'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        active
                          ? 'bg-primary-subtle text-primary-subtle-foreground'
                          : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                )
              })}
            </div>

            <Dropdown
              align="end"
              label="Document actions"
              trigger={
                <Button variant="ghost" size="icon" aria-label="More document actions">
                  <Ellipsis aria-hidden="true" />
                </Button>
              }
            >
              {/* Duplicated here so the panels stay reachable below `md`,
                  where the toggle strip is hidden for space. */}
              {(Object.keys(PANEL_ICONS) as EditorPanel[]).map((panel) => {
                const Icon = PANEL_ICONS[panel]
                return (
                  <DropdownItem
                    key={panel}
                    icon={<Icon aria-hidden="true" />}
                    onClick={() => onPanelChange(activePanel === panel ? null : panel)}
                  >
                    {PANEL_LABELS[panel]}
                  </DropdownItem>
                )
              })}

              <DropdownSeparator />

              <DropdownItem
                variant="danger"
                icon={<Trash2 aria-hidden="true" />}
                onClick={() =>
                  toast.show({
                    title: "Deleting documents isn’t built yet",
                    description: 'It needs the workspace permission model, which is not built.',
                  })
                }
              >
                Delete document
              </DropdownItem>
            </Dropdown>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SaveStatus
            connection={connection}
            sync={sync}
            lastSavedAt={lastSavedAt}
            disconnectReason={disconnectReason}
          />
          <TypingIndicator participants={participants} selfId={selfId} />
        </div>
      </div>
    </header>
  )
}
