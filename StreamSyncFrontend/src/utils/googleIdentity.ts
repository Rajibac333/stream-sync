/**
 * Loading Google Identity Services (GIS).
 *
 * No npm package: GIS is a single script Google serves from its own CDN and
 * exposes as `window.google.accounts.id`. Adding a wrapper dependency for one
 * script tag and three method calls would be exactly the unnecessary
 * dependency CLAUDE.md Rule 5 warns against — this loader is the whole cost.
 *
 * The load is memoised at module scope so mounting the button twice (StrictMode's
 * double effect, or two auth screens in one session) fetches the script once and
 * shares the result rather than racing two `<script>` tags.
 */

export interface GoogleCredentialResponse {
  /** The signed ID token JWT. Forwarded to the backend unverified — see api/auth.ts. */
  credential: string
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    // Skips Google's "no active session" console noise in browsers that block
    // third-party cookies — this app never uses One Tap's auto-select anyway.
    use_fedcm_for_prompt?: boolean
  }): void
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_black' | 'filled_blue'
      size?: 'large' | 'medium' | 'small'
      shape?: 'rectangular' | 'pill' | 'circle' | 'square'
      text?: 'signin_with' | 'signup_with' | 'continue_with'
      logo_alignment?: 'left' | 'center'
      width?: number
    },
  ): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

let loadPromise: Promise<GoogleAccountsId> | null = null

/** Resolves once `window.google.accounts.id` exists, loading the script at most once. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id)

  loadPromise ??= new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)

    const onLoad = () => {
      if (window.google?.accounts.id) resolve(window.google.accounts.id)
      else reject(new Error('Google Identity Services loaded but did not initialise.'))
    }

    if (existing) {
      existing.addEventListener('load', onLoad, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener(
      'error',
      () => reject(new Error('Failed to load Google Identity Services.')),
      { once: true },
    )
    document.head.appendChild(script)
  })

  return loadPromise
}
