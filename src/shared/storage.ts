import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  ExtensionSettings,
  FeatureToggles,
  ShortcutSettings,
  STORAGE_KEY,
} from './settings';

type PartialSettingsPayload = {
  featureToggles?: Partial<FeatureToggles>;
  shortcuts?: ShortcutSettings;
};

function mergeFeatureToggles(saved?: Partial<FeatureToggles>): FeatureToggles {
  const savedToggles = saved || {};
  const migratedWide =
    savedToggles.wideScreen ??
    (typeof (savedToggles as Record<string, boolean>).cleanUI === 'boolean'
      ? (savedToggles as Record<string, boolean>).cleanUI
      : undefined) ??
    (typeof (savedToggles as Record<string, boolean>).focusControl === 'boolean'
      ? (savedToggles as Record<string, boolean>).focusControl
      : undefined);

  return {
    ...DEFAULT_FEATURE_TOGGLES,
    ...savedToggles,
    wideScreen:
      typeof migratedWide === 'boolean' ? migratedWide : DEFAULT_FEATURE_TOGGLES.wideScreen,
    safeSend:
      typeof savedToggles.safeSend === 'boolean'
        ? savedToggles.safeSend
        : DEFAULT_FEATURE_TOGGLES.safeSend,
    preserveScrollOnSend:
      typeof savedToggles.preserveScrollOnSend === 'boolean'
        ? savedToggles.preserveScrollOnSend
        : DEFAULT_FEATURE_TOGGLES.preserveScrollOnSend,
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const saved = result[STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
      const featureToggles = mergeFeatureToggles(saved?.featureToggles);
      const shortcuts = { ...DEFAULT_SHORTCUTS, ...(saved?.shortcuts || {}) };

      resolve({ featureToggles, shortcuts });
    });
  });
}

export async function saveSettings(partial: PartialSettingsPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const current = (result[STORAGE_KEY] as Partial<ExtensionSettings>) || {};
      const next: ExtensionSettings = {
        featureToggles: {
          ...DEFAULT_FEATURE_TOGGLES,
          ...(current.featureToggles || {}),
          ...(partial.featureToggles || {}),
        },
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          ...(current.shortcuts || {}),
          ...(partial.shortcuts || {}),
        },
      };

      chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  });
}
