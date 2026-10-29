import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['packages/license-react/**', 'jsdom']],
  },
})
