import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { build as viteBuild, defineConfig, type Plugin } from 'vite';

import manifest from './src/manifest/manifest.config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const r = (...segments: string[]) => resolve(rootDir, ...segments);
const distDir = r('dist');

function buildManifest() {
  return {
    ...manifest,
    action: {
      ...manifest.action,
      default_popup: 'src/popup/index.html',
    },
    options_ui: {
      ...manifest.options_ui,
      page: 'src/popup/index.html',
    },
    background: {
      ...manifest.background,
      service_worker: 'background.js',
    },
    content_scripts: manifest.content_scripts?.map((script) => ({
      ...script,
      js: ['content.js'],
      css: ['content.css'],
    })),
    web_accessible_resources: manifest.web_accessible_resources?.map((resource) => ({
      ...resource,
      resources: ['inject.js'],
    })),
  };
}

async function buildContentScript(isProd: boolean) {
  await viteBuild({
    configFile: false,
    publicDir: false,
    resolve: {
      alias: {
        '@': r('src'),
      },
    },
    esbuild: {
      drop: isProd ? ['console', 'debugger'] : [],
    },
    build: {
      emptyOutDir: false,
      outDir: distDir,
      lib: {
        entry: r('src/content/index.ts'),
        name: 'ChatGptUnifiedContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      minify: isProd ? 'esbuild' : false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
}

function extensionManifestPlugin(isProd: boolean): Plugin {
  return {
    name: 'extension-manifest',
    apply: 'build',
    buildStart() {
      [
        'src/content/index.ts',
        'src/content/features/shortcuts.ts',
        'src/content/features/ui-tweaks.ts',
        'src/content/features/utils.ts',
        'src/content/styles.css',
      ].forEach((file) => this.addWatchFile(r(file)));
    },
    async closeBundle() {
      mkdirSync(distDir, { recursive: true });
      cpSync(r('_locales'), resolve(distDir, '_locales'), { recursive: true });
      cpSync(r('src/content/styles.css'), resolve(distDir, 'content.css'));
      await buildContentScript(isProd);
      writeFileSync(
        resolve(distDir, 'manifest.json'),
        `${JSON.stringify(buildManifest(), null, 2)}\n`
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    plugins: [preact(), extensionManifestPlugin(isProd)],
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
