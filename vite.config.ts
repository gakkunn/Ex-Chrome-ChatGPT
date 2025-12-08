import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

import manifest from './src/manifest/manifest.config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const r = (...segments: string[]) => resolve(rootDir, ...segments);

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    plugins: [preact(), crx({ manifest })],
    resolve: {
      alias: {
        '@': r('src'),
      },
    },
    esbuild: {
      drop: isProd ? ['console', 'debugger'] : [],
    },
    build: {
      rollupOptions: {
        input: {
          background: r('src/background/index.ts'),
          content: r('src/content/index.ts'),
          popup: r('src/popup/index.html'),
          inject: r('src/inject/index.ts'),
        },
        output: {
          entryFileNames: (chunk) => `${chunk.name}.js`,
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});

