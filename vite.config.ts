/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is served from https://<user>.github.io/satisfactory-tools/ on GitHub
// Pages, so built assets must be referenced under that sub-path. During local
// `vite dev`/`vitest` we keep the root base so everything resolves at `/`.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/satisfactory-tools/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
}))
