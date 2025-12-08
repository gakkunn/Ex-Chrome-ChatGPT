import '@/content/styles.css';

import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  ExtensionSettings,
  FeatureToggles,
  STORAGE_KEY,
} from '@/shared/settings';
import { loadSettings } from '@/shared/storage';

import { ShortcutsManager } from './features/shortcuts';
import { UITweaksManager } from './features/ui-tweaks';

let shortcutsManager: ShortcutsManager | null = null;
let uiTweaksManager: UITweaksManager | null = null;
let currentSettings: ExtensionSettings | null = null;
let bootstrapPromise: Promise<void> | null = null;

const DEFAULT_SETTINGS: ExtensionSettings = {
  featureToggles: { ...DEFAULT_FEATURE_TOGGLES },
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

/**
 * Checks if the extension context is still valid.
 * Returns false when the extension has been reloaded/updated while the content script is still running.
 */
function isExtensionContextValid(): boolean {
  try {
    // If chrome.runtime.id is accessible, the extension context is valid
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function applyDocumentFlags(toggles: FeatureToggles) {
  const root = document.documentElement;
  if (toggles.wideScreen) {
    root.setAttribute('data-chatgpt-unified-wide', 'true');
  } else {
    root.removeAttribute('data-chatgpt-unified-wide');
  }
}

function waitForDocumentReady(): Promise<void> {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

async function bootstrap(_reason: string) {
  try {
    // Check if extension context is still valid before attempting Chrome API calls
    if (!isExtensionContextValid()) {
      currentSettings = { ...DEFAULT_SETTINGS };
      applyDocumentFlags(currentSettings.featureToggles);

      if (!uiTweaksManager) {
        uiTweaksManager = new UITweaksManager(currentSettings.featureToggles);
      } else {
        uiTweaksManager.updateToggles(currentSettings.featureToggles);
      }

      if (!shortcutsManager) {
        shortcutsManager = new ShortcutsManager(currentSettings, () =>
          uiTweaksManager?.toggleFocus()
        );
      } else {
        shortcutsManager.updateSettings(currentSettings);
      }
      return;
    }

    await waitForDocumentReady();
    const loaded = await loadSettings();
    currentSettings = loaded
      ? {
          featureToggles: { ...DEFAULT_FEATURE_TOGGLES, ...loaded.featureToggles },
          shortcuts: { ...DEFAULT_SHORTCUTS, ...loaded.shortcuts },
        }
      : { ...DEFAULT_SETTINGS };

    applyDocumentFlags(currentSettings.featureToggles);

    if (uiTweaksManager) {
      uiTweaksManager.updateToggles(currentSettings.featureToggles);
    } else {
      uiTweaksManager = new UITweaksManager(currentSettings.featureToggles);
    }

    if (shortcutsManager) {
      shortcutsManager.updateSettings(currentSettings);
    } else {
      shortcutsManager = new ShortcutsManager(currentSettings, () =>
        uiTweaksManager?.toggleFocus()
      );
    }
  } catch (error) {
    console.error('ChatGPT Shortcut Extension: bootstrap failed, falling back to defaults.', error);
    currentSettings = { ...DEFAULT_SETTINGS };
    applyDocumentFlags(currentSettings.featureToggles);

    if (!uiTweaksManager) {
      uiTweaksManager = new UITweaksManager(currentSettings.featureToggles);
    } else {
      uiTweaksManager.updateToggles(currentSettings.featureToggles);
    }

    if (!shortcutsManager) {
      shortcutsManager = new ShortcutsManager(currentSettings, () =>
        uiTweaksManager?.toggleFocus()
      );
    } else {
      shortcutsManager.updateSettings(currentSettings);
    }
  } finally {
    bootstrapPromise = null;
  }
}

function ensureBootstrap(reason: string) {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = bootstrap(reason);
  return bootstrapPromise;
}

// Apply defaults immediately to avoid a blank state if storage read is delayed.
applyDocumentFlags(DEFAULT_FEATURE_TOGGLES);
ensureBootstrap('initial');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ensureBootstrap('domcontentloaded'), {
    once: true,
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ensureBootstrap('visibility');
  }
});

setTimeout(() => ensureBootstrap('delayed'), 1500);

// Only register storage listener if extension context is valid
if (isExtensionContextValid()) {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    ensureBootstrap('storage-change');
  });

  // Inject Page Context Script (for history & network interception)
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/inject/index.ts');
  script.addEventListener('load', () => {
    script.remove();
  });
  (document.head || document.documentElement).appendChild(script);
}
