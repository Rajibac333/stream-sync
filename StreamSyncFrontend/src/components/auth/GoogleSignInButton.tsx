import { useEffect, useId, useRef, useState } from 'react'

import { config } from '@/app/config'
import { useGoogleLogin } from '@/hooks/useAuth'
import { toast } from '@/store/toastStore'
import { useTheme } from '@/hooks/useTheme'
import { isApiError } from '@/types/api'
import { loadGoogleIdentity, type GoogleCredentialResponse } from '@/utils/googleIdentity'

/**
 * "Continue with Google". (CLAUDE.md §25)
 *
 * Renders Google's own button widget rather than a styled lookalike — GIS
 * requires the real, unmodified button for its click to be trusted, and
 * reimplementing its accessibility (focus, keyboard activation, the account
 * chooser) would be strictly worse than the one Google already ships.
 *
 * Renders nothing when `VITE_GOOGLE_CLIENT_ID` is unset. That is a supported,
 * ordinary configuration — see app/config.ts — not a broken one: a deployment
 * without Google sign-in configured should show a plain login form, not a
 * button that fails the moment it's clicked.
 */

export interface GoogleSignInButtonProps {
  /** Called once the exchanged session has been written to the query cache. */
  onSuccess: () => void
}

export function GoogleSignInButton({ onSuccess }: GoogleSignInButtonProps) {
  const clientId = config.google.clientId
  const containerRef = useRef<HTMLDivElement>(null)
  const [unavailable, setUnavailable] = useState(false)
  const { resolved } = useTheme()
  const statusId = useId()

  const googleLogin = useGoogleLogin()
  // Mutation identity is stable across renders (React Query memoises it), but
  // the callback closes over it at initialize()-time — a ref keeps that
  // closure reading the *current* mutation without re-initialising the
  // widget, which Google's SDK does not expect to happen more than once.
  const mutateRef = useRef(googleLogin.mutateAsync)
  mutateRef.current = googleLogin.mutateAsync

  useEffect(() => {
    if (!clientId || !containerRef.current) return

    let cancelled = false

    const handleCredential = ({ credential }: GoogleCredentialResponse) => {
      mutateRef.current(credential)
        .then(onSuccess)
        .catch((error: unknown) => {
          toast.error({
            title: "Couldn't sign in with Google",
            description: isApiError(error) ? error.message : undefined,
          })
        })
    }

    loadGoogleIdentity()
      .then((accountsId) => {
        if (cancelled || !containerRef.current) return

        accountsId.initialize({
          client_id: clientId,
          callback: handleCredential,
          use_fedcm_for_prompt: true,
        })
        accountsId.renderButton(containerRef.current, {
          type: 'standard',
          theme: resolved === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: containerRef.current.clientWidth || 320,
        })
      })
      .catch(() => {
        // A network/CSP block, not a credential failure — there is nothing to
        // retry client-side, so this degrades to the fallback note below
        // rather than an error toast for a button the user never clicked.
        if (!cancelled) setUnavailable(true)
      })

    return () => {
      cancelled = true
    }
    // Re-initializing on every render would tear down and rebuild Google's
    // iframe-hosted widget for no reason; theme is the one input the button's
    // own appearance genuinely depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, resolved])

  if (!clientId) return null

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        className="flex w-full justify-center empty:hidden"
        aria-busy={googleLogin.isPending}
      />
      {unavailable ? (
        <p id={statusId} role="status" className="text-caption text-foreground-subtle">
          Google sign-in isn’t available right now.
        </p>
      ) : null}
    </div>
  )
}

/** A labelled divider between the password form and the Google button. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
      <span className="text-caption text-foreground-subtle">{label}</span>
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
    </div>
  )
}
