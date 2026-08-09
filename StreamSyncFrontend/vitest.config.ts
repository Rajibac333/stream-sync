import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Test configuration.
 *
 * Kept separate from vite.config.ts so the production build never carries test
 * settings, and so the Tailwind plugin is absent here — tests assert behaviour
 * and accessible structure, never computed styles, and compiling the stylesheet
 * for every run would cost seconds for nothing.
 *
 * CLAUDE.md §75
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // Explicit imports rather than globals: it keeps `describe`/`it`/`expect`
    // out of the application's type environment, so nothing in src/ can lean on
    // a test-only global by accident.
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
