import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import { getMessage } from '@/shared/i18n';
import type { MessageKey } from '@/shared/i18n';
import {
  bindingsEqual,
  formatBindingString,
  formatBindingTokens,
  isMacPlatform,
  isModKey,
  normalizeBinding,
} from '@/shared/keyboard';
import {
  CHATGPT_DEFAULT_SHORTCUTS,
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  ExtensionSettings,
  FeatureToggles,
  FeatureCategory,
  KeyBinding,
  ShortcutDefinition,
  ShortcutId,
  SHORTCUT_DEFINITIONS,
} from '@/shared/settings';
import { loadSettings, saveSettings } from '@/shared/storage';

type MessageState = { type: 'error' | 'warning'; text: string } | null;
type InputStateMap = Partial<Record<ShortcutId, 'error' | 'warning'>>;

const GITHUB_URL = 'https://github.com/gakkunn/Ex-Chrome-ChatGPT';
const SUPPORT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScm_N4J2Sv-WE0Y-fdU-gwUl4OfWM81v1NaGjZ16PSZbrVm_w/viewform';
const COFFEE_URL = 'https://buymeacoffee.com/gakkunn';
const REVIEW_URL =
  'https://chromewebstore.google.com/detail/chatgpt-shortcut-effectiv/aoemceeicbdlapmljecabaegdjnifllg/reviews?hl=en&authuser=0';

const ICON_GITHUB_SRC = '/img/github.svg';
const ICON_SUPPORT_SRC = '/img/support.svg';
const ICON_COFFEE_SRC = '/img/coffee.svg';
const ICON_REVIEW_SRC = '/img/review.svg';

const FEATURE_LABEL_KEYS: Record<FeatureCategory, MessageKey> = {
  vimScroll: 'popup_feature_label_vim_scroll',
  wideScreen: 'popup_feature_label_wide_screen',
  safeSend: 'popup_feature_label_safe_send',
  otherShortcuts: 'popup_feature_label_other_shortcuts',
};

const featureOrder: FeatureCategory[] = ['vimScroll', 'wideScreen', 'safeSend', 'otherShortcuts'];

const formatBinding = (binding: KeyBinding) => formatBindingString(binding);

const eventToBinding = (event: KeyboardEvent): KeyBinding | null => {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return null;
  const key = event.key === 'Spacebar' ? ' ' : event.key;
  const mod = isModKey(event);
  return {
    key,
    code: event.code,
    mod,
    meta: mod ? false : event.metaKey,
    ctrl: mod ? false : event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
};

const SINGLE_KEY_REQUIRE_MOD = new Set(['Escape', 'Esc', 'Backspace', 'Delete']);
const SINGLE_CODE_REQUIRE_MOD = new Set(['Escape', 'Backspace', 'Delete']);

const FORBIDDEN_KEYS = new Set([
  'Enter',
  'Return',
  'Tab',
  // IME / input-mode switching keys
  'Eisu',
  'Alphanumeric',
  'KanaMode',
  'Zenkaku',
  'Hankaku',
  'HankakuZenkaku',
  'Henkan',
  'NonConvert',
  'Kana',
  'Kanji',
  'Katakana',
  'Hiragana',
  'Romaji',
  // Lock keys
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

const FORBIDDEN_CODES = new Set([
  'Enter',
  'NumpadEnter',
  'Tab',
  // IME / input-mode switching codes
  'Eisu',
  'NonConvert',
  'Convert',
  'KanaMode',
  'Lang1',
  'Lang2',
  'Lang3',
  'Lang4',
  'Lang5',
  // Lock codes
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);
const WINDOWS_KEY_NAMES = new Set(['meta', 'os', 'win', 'super']);
const WINDOWS_KEY_CODES = new Set(['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

const requiresModifierOnlyKey = (binding: KeyBinding): boolean => {
  const normalized = normalizeBinding(binding);
  const unmodified =
    !normalized.meta && !normalized.ctrl && !normalized.shift && !normalized.alt && !normalized.mod;
  const keyMatch = SINGLE_KEY_REQUIRE_MOD.has(binding.key);
  const codeMatch = binding.code ? SINGLE_CODE_REQUIRE_MOD.has(binding.code) : false;
  return unmodified && (keyMatch || codeMatch);
};

const usesWindowsKey = (binding: KeyBinding): boolean => {
  const keyLower = binding.key.toLowerCase();
  const keyMatch = WINDOWS_KEY_NAMES.has(keyLower);
  const codeMatch = binding.code ? WINDOWS_KEY_CODES.has(binding.code) : false;
  const normalized = normalizeBinding(binding);
  const metaOnWindows = !isMacPlatform && normalized.meta;
  return keyMatch || codeMatch || metaOnWindows;
};

const isForbiddenBinding = (binding: KeyBinding): boolean => {
  const keyMatch = FORBIDDEN_KEYS.has(binding.key);
  const codeMatch = binding.code ? FORBIDDEN_CODES.has(binding.code) : false;
  if (keyMatch || codeMatch) return true;
  return usesWindowsKey(binding);
};

const validateBinding = (
  binding: KeyBinding
): { type: 'requiresModifier' | 'forbidden'; messageKey: MessageKey } | null => {
  if (isForbiddenBinding(binding)) {
    return { type: 'forbidden', messageKey: 'popup_message_forbidden_key' };
  }
  if (requiresModifierOnlyKey(binding)) {
    return { type: 'requiresModifier', messageKey: 'popup_message_requires_modifier' };
  }
  return null;
};

const bindingsMatch = (a: KeyBinding, b: KeyBinding) => bindingsEqual(a, b);

const findConflictingShortcut = (
  settings: ExtensionSettings,
  binding: KeyBinding,
  currentId: ShortcutId
): ShortcutDefinition | null => {
  return (
    SHORTCUT_DEFINITIONS.find((def) => {
      if (def.id === currentId) return false;
      if (!settings.featureToggles[def.category]) return false;
      const current = settings.shortcuts[def.id];
      const bindings = Array.isArray(current) && current.length ? current : def.defaultBindings;
      return bindings.some((existing) => bindingsMatch(existing, binding));
    }) || null
  );
};

const findChatGPTDefaultConflict = (binding: KeyBinding) =>
  CHATGPT_DEFAULT_SHORTCUTS.find((defaultShortcut) => bindingsMatch(defaultShortcut, binding)) ||
  null;

const isShowShortcutsBinding = (binding: KeyBinding) => {
  const normalized = normalizeBinding(binding);
  const usesSlash = binding.key === '/' || binding.code === 'Slash';
  const usesOnlyPlatformMod =
    !normalized.shift &&
    !normalized.alt &&
    ((isMacPlatform && normalized.meta) || (!isMacPlatform && normalized.ctrl));
  return usesSlash && usesOnlyPlatformMod;
};

const renderBindingKeycaps = (bindings: KeyBinding[]): JSX.Element[] => {
  const elements: JSX.Element[] = [];

  bindings.forEach((binding, bindingIndex) => {
    const tokens = formatBindingTokens(binding);
    elements.push(
      <div class="shortcut-keycap-group" key={`${binding.code || binding.key}-${bindingIndex}`}>
        {tokens.map((token, tokenIndex) => (
          <span class="shortcut-keycap-wrapper" key={`${token}-${tokenIndex}`}>
            <kbd class="chatgpt-unified-keycap">
              <span class="chatgpt-unified-keycap-label">{token}</span>
            </kbd>
            {!isMacPlatform && tokenIndex < tokens.length - 1 && (
              <span class="chatgpt-unified-keycap-sep">+</span>
            )}
          </span>
        ))}
      </div>
    );

    if (bindingIndex < bindings.length - 1) {
      elements.push(
        <span
          class="shortcut-binding-sep"
          key={`sep-${binding.code || binding.key}-${bindingIndex}`}
        >
          /
        </span>
      );
    }
  });

  return elements;
};

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<MessageState>(null);
  const [inputStates, setInputStates] = useState<InputStateMap>({});
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let active = true;
    loadSettings()
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch(() => {
        if (!active) return;
        setSettings({
          featureToggles: { ...DEFAULT_FEATURE_TOGGLES },
          shortcuts: { ...DEFAULT_SHORTCUTS },
        });
        setMessage({
          type: 'warning',
          text: getMessage('popup_message_load_failed'),
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const clearIndicators = useCallback(() => {
    setMessage(null);
    setInputStates({});
  }, []);

  const handleToggleChange = useCallback(
    async (category: FeatureCategory, checked: boolean) => {
      if (!settings) return;
      const next: ExtensionSettings = {
        ...settings,
        featureToggles: { ...settings.featureToggles, [category]: checked },
      };
      setSettings(next);
      const partialToggles: Partial<FeatureToggles> = { [category]: checked };
      await saveSettings({ featureToggles: partialToggles });
    },
    [settings]
  );

  const handleReset = useCallback(async () => {
    setResetting(true);
    clearIndicators();
    const next: ExtensionSettings = {
      featureToggles: { ...DEFAULT_FEATURE_TOGGLES },
      shortcuts: { ...DEFAULT_SHORTCUTS },
    };
    setSettings(next);
    await saveSettings(next);
    setResetting(false);
  }, [clearIndicators]);

  const getBindingsFor = useCallback(
    (def: ShortcutDefinition): KeyBinding[] => {
      if (!settings) return def.defaultBindings;
      const value = settings.shortcuts[def.id];
      if (Array.isArray(value) && value.length) {
        return value;
      }
      return def.defaultBindings;
    },
    [settings]
  );

  const handleShortcutCapture = useCallback(
    (def: ShortcutDefinition): JSX.KeyboardEventHandler<HTMLDivElement> =>
      async (event) => {
        event.preventDefault();
        const binding = eventToBinding(event as unknown as KeyboardEvent);
        if (!binding || !settings) return;

        clearIndicators();

        const validationResult = validateBinding(binding);
        if (validationResult) {
          setMessage({
            type: 'error',
            text: getMessage(validationResult.messageKey, [formatBinding(binding)]),
          });
          setInputStates({ [def.id]: 'error' });
          return;
        }

        const conflict = findConflictingShortcut(settings, binding, def.id);
        if (conflict) {
          setMessage({
            type: 'error',
            text: getMessage('popup_message_conflict', [
              formatBinding(binding),
              getMessage(conflict.labelKey),
            ]),
          });
          setInputStates({ [def.id]: 'error' });
          return;
        }

        if (isShowShortcutsBinding(binding)) {
          setMessage({
            type: 'error',
            text: getMessage('popup_message_reserved', [
              formatBinding(binding),
              getMessage('chatgpt_shortcut_show_shortcuts'),
            ]),
          });
          setInputStates({ [def.id]: 'error' });
          return;
        }

        const chatgptConflict = findChatGPTDefaultConflict(binding);
        if (chatgptConflict) {
          setMessage({
            type: 'warning',
            text: getMessage('popup_message_chatgpt_conflict', [
              formatBinding(binding),
              getMessage(chatgptConflict.labelKey),
            ]),
          });
          setInputStates({ [def.id]: 'warning' });
        }

        const next: ExtensionSettings = {
          ...settings,
          shortcuts: {
            ...settings.shortcuts,
            [def.id]: [binding],
          },
        };
        setSettings(next);
        await saveSettings({ shortcuts: { [def.id]: [binding] } });
      },
    [clearIndicators, settings]
  );

  const visibleDefinitions = useMemo(() => {
    if (!settings) return [];
    return SHORTCUT_DEFINITIONS.filter((def) => settings.featureToggles[def.category]);
  }, [settings]);

  return (
    <div class="popup-wrapper">
      <header class="header-row">
        <div>
          <h1>{getMessage('app_name_short')}</h1>
        </div>
        <button
          class="reset-button"
          type="button"
          onClick={handleReset}
          disabled={resetting || loading}
        >
          {getMessage('popup_button_reset')}
        </button>
      </header>

      <footer class="popup-footer">
        <p class="footer-message">{getMessage('popup_footer_review_prompt')}</p>
        <section class="links">
          <div>
            <a
              class="footer-button github-button"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Contribute"
            >
              <span>
                <img class="icon" src={ICON_GITHUB_SRC} alt="Contribute" />
              </span>
            </a>
          </div>
          <div>
            <a
              class="footer-button question-button"
              href={SUPPORT_FORM_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Support"
            >
              <span>
                <img class="icon" src={ICON_SUPPORT_SRC} alt="Report a problem" />
              </span>
            </a>
          </div>
          <div>
            <a
              class="footer-button review-button"
              href={REVIEW_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Review"
            >
              <span>
                <img class="icon" src={ICON_REVIEW_SRC} alt="Review" />
              </span>
            </a>
          </div>
          <div>
            <a
              class="footer-button coffee-button"
              href={COFFEE_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Buy me a coffee"
            >
              <span>
                <img class="icon" src={ICON_COFFEE_SRC} alt="Buy me a coffee" />
              </span>
            </a>
          </div>
        </section>
      </footer>

      {loading && <p class="helper-text">{getMessage('popup_loading')}</p>}

      {!loading && settings && (
        <>
          <section class="card">
            <h2>{getMessage('popup_section_features')}</h2>
            <div class="toggle-list">
              {featureOrder.map((category) => (
                <label class="toggle" key={category}>
                  <input
                    type="checkbox"
                    checked={!!settings.featureToggles[category]}
                    onChange={(event) => handleToggleChange(category, event.currentTarget.checked)}
                  />
                  <span>{getMessage(FEATURE_LABEL_KEYS[category])}</span>
                </label>
              ))}
            </div>
          </section>

          <section class="card">
            <h2>{getMessage('popup_section_shortcuts')}</h2>
            <div
              class="shortcut-message"
              data-status={message?.type ?? ''}
              aria-live="polite"
              role="status"
            >
              {message?.text ?? ''}
            </div>
            {visibleDefinitions.length === 0 && (
              <p class="helper-text">{getMessage('popup_helper_shortcuts_empty')}</p>
            )}
            {visibleDefinitions.map((def) => {
              const bindings = getBindingsFor(def);
              return (
                <div class="shortcut-row" key={def.id}>
                  <div class="shortcut-label">
                    <p>{getMessage(def.labelKey)}</p>
                    <small>
                      {def.category === 'vimScroll'
                        ? getMessage('popup_label_navigation')
                        : getMessage('popup_label_action')}
                    </small>
                  </div>
                  <div
                    class={`shortcut-input ${
                      inputStates[def.id] === 'error'
                        ? 'shortcut-input-error'
                        : inputStates[def.id] === 'warning'
                          ? 'shortcut-input-warning'
                          : ''
                    }`}
                    role="textbox"
                    tabIndex={0}
                    aria-label={getMessage(def.labelKey)}
                    onClick={(event) => event.currentTarget.focus()}
                    onKeyDown={handleShortcutCapture(def)}
                  >
                    <div class="shortcut-keycaps">
                      {bindings.length ? (
                        renderBindingKeycaps(bindings)
                      ) : (
                        <span class="shortcut-placeholder">
                          {getMessage('popup_placeholder_shortcut')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

    </div>
  );
}
