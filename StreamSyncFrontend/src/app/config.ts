import { z } from 'zod'

/**
 * Application configuration.
 *
 * Environment variables are parsed and validated exactly once, here. Every
 * other module imports the frozen `config` object rather than touching
 * `import.meta.env`, which means:
 *
 *   - a typo in a variable name fails loudly at boot, not silently at runtime
 *   - defaults live in one place
 *   - the rest of the app consumes real types (number, boolean) not strings
 *
 * CLAUDE.md §79
 */

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const envSchema = z.object({
  VITE_API_BASE_URL: z.url().default('http://localhost:8000/api'),
  VITE_WS_BASE_URL: z.string().min(1).default('ws://localhost:8000/ws'),
  VITE_API_TIMEOUT: z.coerce.number().int().positive().default(15_000),
  VITE_ENABLE_DEVTOOLS: booleanFromString.default(import.meta.env.DEV),
  // No .default(''): an empty string and "not configured" must stay
  // distinguishable, because config.google.clientId is what decides whether
  // the Google button renders at all.
  VITE_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
})

const parsed = envSchema.safeParse(import.meta.env)

if (!parsed.success) {
  // Fail fast and readably. A misconfigured environment should never reach the
  // point where it surfaces as a confusing network error three screens later.
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')

  throw new Error(
    `Invalid StreamSync environment configuration:\n${issues}\n\n` +
      'Copy .env.example to .env.local and fill in the missing values.',
  )
}

const env = parsed.data

export const config = Object.freeze({
  api: {
    baseUrl: env.VITE_API_BASE_URL.replace(/\/$/, ''),
    timeout: env.VITE_API_TIMEOUT,
  },
  websocket: {
    baseUrl: env.VITE_WS_BASE_URL.replace(/\/$/, ''),
    /** Reconnect ceiling for the exponential backoff in Milestone 6. (§57) */
    maxReconnectAttempts: 8,
    baseReconnectDelayMs: 1_000,
    maxReconnectDelayMs: 30_000,
    heartbeatIntervalMs: 25_000,
  },
  features: {
    devtools: env.VITE_ENABLE_DEVTOOLS,
  },
  google: {
    /**
     * Not secret. A Google OAuth Client ID identifies the *application*, the
     * same way a domain name does — Google's own docs say it is safe to ship
     * in frontend code, which is why this is the one credential-shaped value
     * in this file that isn't a mistake. `null` (not `''`) when unset, so
     * `GoogleSignInButton` can render nothing rather than a broken button.
     */
    clientId: env.VITE_GOOGLE_CLIENT_ID ?? null,
  },
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const)

export type AppConfig = typeof config
