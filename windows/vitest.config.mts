import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'renderer/src/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
