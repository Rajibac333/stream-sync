import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end configuration. (CLAUDE.md §75, §84)
 *
 * Every spec runs the real application against the real Django API. There is no
 * mock mode any more, which means these are the only tests that can catch a
 * disagreement between the two halves — both sides pass their own suites while
 * disagreeing about the JSON between them.
 *
 * PREREQUISITE: the API must be running on http://localhost:8000 against a
 * migrated database. Nothing here starts it: a runner that silently spawns a
 * backend also silently hides that the backend is broken.
 *
 * Each spec registers its own account and builds its own workspace, so the
 * suite is repeatable against a database that already has data in it.
 *
 * BROWSER
 * Playwright's bundled Chromium does not support macOS 13, so local runs use
 * the installed Google Chrome via `channel`. CI should drop the channel and use
 * the pinned Chromium instead — reproducibility matters more there than
 * matching whatever a developer happens to have installed.
 */

const PORT = 5273
const HOST = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  /* Sequential. The specs share one database, and a parallel run makes a
     failure ambiguous between "the feature is broken" and "two specs
     collided". */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Generous: a live run pays for real database writes, and each spec builds
  // its own account and workspace before it can assert anything.
  timeout: 90_000,

  use: {
    baseURL: HOST,
    /* The app honours `prefers-reduced-motion` (§20), and running the suite
       that way removes a real source of flake: a click on a control inside the
       opening drawer otherwise races its own transition, and Playwright
       reports "element is not stable" for a button that is perfectly fine.
       These specs assert behaviour, not motion — and this exercises the
       reduced-motion path, which nothing else covers. */
    contextOptions: { reducedMotion: 'reduce' },
    // Artefacts on failure only: a passing run should leave nothing behind.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chrome',
      // The responsive spec belongs to the mobile project; running it at
      // desktop width would assert a drawer that is correctly absent.
      testIgnore: /responsive\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
    /* A phone viewport — the width §18 calls out, and where the drawer replaces
       the sidebar. Runs the responsive spec only; re-running everything at two
       widths doubles the time for very little extra signal.

       Pixel 5 rather than an iPhone profile: the iPhone devices default to
       WebKit, which cannot be driven through the Chrome channel this machine
       falls back to. */
    {
      name: 'mobile',
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
  ],

  webServer: {
    // The dev server rather than a preview build: these specs test application
    // behaviour, not the bundler, and not rebuilding on every run keeps the
    // feedback loop short enough that people actually run them.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: HOST,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
