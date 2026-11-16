/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base: './'` makes the build work from any sub-path, e.g. https://<user>.github.io/Opening-Trainer/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // The opening book is a deliberately separate, lazily loaded chunk.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
