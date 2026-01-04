import type { MessageKey } from './i18n';

export type FeatureCategory = 'vimScroll' | 'wideScreen' | 'safeSend' | 'otherShortcuts';

export type ShortcutId =
  | 'scrollTop'
  | 'scrollBottom'
  | 'scrollUp'
  | 'scrollDown'
  | 'scrollHalfUp'
  | 'scrollHalfDown'
  | 'toggleFocus'
  | 'toggleModel'
  | 'modeAuto'
  | 'modeInstant'
  | 'modeThinking'
  | 'temporaryChat'
  | 'togglePinChat';

export type KeyBinding = {
  key: string;
  code?: string;
  mod?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export interface ChatGPTDefaultShortcut extends KeyBinding {
  labelKey: MessageKey;
}

export type FeatureToggles = Record<FeatureCategory, boolean>;

export type ShortcutSettings = Partial<Record<ShortcutId, KeyBinding[]>>;

export interface ExtensionSettings {
  featureToggles: FeatureToggles;
  shortcuts: ShortcutSettings;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  labelKey: MessageKey;
  category: FeatureCategory;
  defaultBindings: KeyBinding[];
}

export const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  vimScroll: true,
  wideScreen: true,
  safeSend: true,
  otherShortcuts: true,
};

const isMacPlatform =
  typeof navigator !== 'undefined' && !!navigator.platform
    ? navigator.platform.toLowerCase().includes('mac')
    : false;

const MODE_INSTANT_DEFAULT_BINDING: KeyBinding = isMacPlatform
  ? { key: '0', code: 'Digit0', mod: true, shift: true }
  : { key: '7', code: 'Digit7', mod: true, shift: true };

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'scrollTop',
    labelKey: 'shortcut_label_scroll_top',
    category: 'vimScroll',
    defaultBindings: [{ key: 'k', code: 'KeyK', mod: true }],
  },
  {
    id: 'scrollBottom',
    labelKey: 'shortcut_label_scroll_bottom',
    category: 'vimScroll',
    defaultBindings: [{ key: 'j', code: 'KeyJ', mod: true }],
  },
  {
    id: 'scrollUp',
    labelKey: 'shortcut_label_scroll_up',
    category: 'vimScroll',
    defaultBindings: [{ key: 'k', code: 'KeyK' }],
  },
  {
    id: 'scrollDown',
    labelKey: 'shortcut_label_scroll_down',
    category: 'vimScroll',
    defaultBindings: [{ key: 'j', code: 'KeyJ' }],
  },
  {
    id: 'scrollHalfUp',
    labelKey: 'shortcut_label_scroll_half_up',
    category: 'vimScroll',
    defaultBindings: [{ key: 'K', code: 'KeyK', shift: true }],
  },
  {
    id: 'scrollHalfDown',
    labelKey: 'shortcut_label_scroll_half_down',
    category: 'vimScroll',
    defaultBindings: [{ key: 'J', code: 'KeyJ', shift: true }],
  },
  {
    id: 'toggleFocus',
    labelKey: 'shortcut_label_toggle_focus',
    category: 'wideScreen',
    defaultBindings: [{ key: ' ', code: 'Space', shift: true }],
  },
  {
    id: 'toggleModel',
    labelKey: 'shortcut_label_toggle_model',
    category: 'otherShortcuts',
    defaultBindings: [{ key: 'ArrowDown', code: 'ArrowDown', mod: true, shift: true }],
  },
  {
    id: 'modeAuto',
    labelKey: 'shortcut_label_mode_auto',
    category: 'otherShortcuts',
    defaultBindings: [{ key: '8', code: 'Digit8', mod: true, shift: true }],
  },
  {
    id: 'modeInstant',
    labelKey: 'shortcut_label_mode_instant',
    category: 'otherShortcuts',
    defaultBindings: [MODE_INSTANT_DEFAULT_BINDING],
  },
  {
    id: 'modeThinking',
    labelKey: 'shortcut_label_mode_thinking',
    category: 'otherShortcuts',
    defaultBindings: [{ key: '9', code: 'Digit9', mod: true, shift: true }],
  },
  {
    id: 'temporaryChat',
    labelKey: 'shortcut_label_temporary_chat',
    category: 'otherShortcuts',
    defaultBindings: [{ key: 'i', code: 'KeyI', mod: true }],
  },
  {
    id: 'togglePinChat',
    labelKey: 'shortcut_label_pin_chat',
    category: 'otherShortcuts',
    defaultBindings: [{ key: 'P', code: 'KeyP', mod: true, shift: true }],
  },
];

export const CHATGPT_DEFAULT_SHORTCUTS: ChatGPTDefaultShortcut[] = [
  { key: 'k', code: 'KeyK', mod: true, labelKey: 'chatgpt_shortcut_search_chats' },
  { key: 'o', code: 'KeyO', mod: true, shift: true, labelKey: 'chatgpt_shortcut_open_new_chat' },
  { key: 's', code: 'KeyS', mod: true, shift: true, labelKey: 'chatgpt_shortcut_toggle_sidebar' },
  {
    key: ';',
    code: 'Semicolon',
    mod: true,
    shift: true,
    labelKey: 'chatgpt_shortcut_copy_last_code_block',
  },
  { key: 'ArrowDown', code: 'ArrowDown', shift: true, labelKey: 'chatgpt_shortcut_next_message' },
  { key: 'ArrowUp', code: 'ArrowUp', shift: true, labelKey: 'chatgpt_shortcut_previous_message' },
  {
    key: 'Backspace',
    code: 'Backspace',
    mod: true,
    shift: true,
    labelKey: 'chatgpt_shortcut_delete_chat',
  },
  { key: 'Escape', code: 'Escape', shift: true, labelKey: 'chatgpt_shortcut_focus_input' },
  { key: 'u', code: 'KeyU', mod: true, labelKey: 'chatgpt_shortcut_add_files' },
  { key: '.', code: 'Period', mod: true, labelKey: 'chatgpt_shortcut_toggle_dev_mode' },
  { key: '/', code: 'Slash', mod: true, labelKey: 'chatgpt_shortcut_show_shortcuts' },
  {
    key: 'i',
    code: 'KeyI',
    mod: true,
    shift: true,
    labelKey: 'chatgpt_shortcut_set_custom_instructions',
  },
];

export const DEFAULT_SHORTCUTS: ShortcutSettings = SHORTCUT_DEFINITIONS.reduce((acc, def) => {
  acc[def.id] = def.defaultBindings;
  return acc;
}, {} as ShortcutSettings);

export const STORAGE_KEY = 'chatgptUnifiedSettings';
