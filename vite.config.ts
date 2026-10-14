/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is served from https://<user>.github.io/satisfactory-tools/ on GitHub
// Pages, so built assets must be referenced under that sub-path (also when
// `vite preview` serves the build). `vite dev`/`vitest` keep the root base.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/satisfactory-tools/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
}))
