import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_app_name_full__',
  description: '__MSG_app_description__',
  version: '1.0.0',
  icons: {
    '16': 'icons/icon16.png',
    '32': 'icons/icon32.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: '__MSG_app_name_short__',
    default_icon: {
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
  },
  options_ui: {
    page: 'src/popup/index.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage'],
  host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  commands: {
    reload_extension_dev: {
      description: 'Reload the extension during development',
      suggested_key: {
        default: 'Ctrl+Shift+R',
        mac: 'Command+Shift+R',
      },
    },
  },
  content_scripts: [
    {
      matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_end',
    },
  ],
  web_accessible_resources: [
    {
      matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      resources: ['src/inject/index.ts'],
    },
  ],
});
