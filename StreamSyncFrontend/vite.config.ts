import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    /**
     * `hidden` emits the .map files but omits the `//# sourceMappingURL`
     * comment, so browsers never fetch them and the sources are not readable
     * from devtools — while a crash reporter can still be given the maps at
     * deploy time to symbolicate a stack. Upload them, then delete them from
     * the published directory.
     */
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        /**
         * Splits the dependencies that change on a different schedule from the
         * application into their own chunks.
         *
         * This does not reduce what a first-time visitor downloads — it changes
         * what a *returning* one has to re-download. Shipping a copy change
         * currently invalidates a single 167 kB entry chunk containing React;
         * split, the React and editor chunks keep their hashes and stay cached.
         */
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react'
          }
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'motion'
          }
          if (/[\\/]node_modules[\\/](@tanstack|axios|zod)[\\/]/.test(id)) return 'data'
          // Everything else — Tiptap, ProseMirror, dnd-kit — stays with the
          // route that lazily imports it, which is where it belongs.
          return undefined
        },
      },
    },
  },
})
