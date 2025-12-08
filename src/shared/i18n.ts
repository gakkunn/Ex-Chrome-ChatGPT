const FALLBACK_MESSAGES = {
  app_name_full: 'ChatGPT Shortcut Effective Extension',
  app_name_short: 'ChatGPT Shortcut Extension',
  app_description:
    'Safer send, vim-like scroll, model toggles, temporary chats, and clean UI for ChatGPT.',
  html_lang: 'en',
  popup_header_title: 'Extension Controls',
  popup_button_reset: 'Reset',
  popup_section_features: 'Features',
  popup_section_shortcuts: 'Shortcuts',
  popup_loading: 'Loading settings...',
  popup_feature_label_vim_scroll: 'Vim-like Scroll',
  popup_feature_label_wide_screen: 'Wide Screen (Clean UI + Focus)',
  popup_feature_label_safe_send: 'Send with Cmd/Ctrl + Enter',
  popup_feature_label_other_shortcuts: 'Other Shortcuts',
  popup_helper_shortcuts_empty: 'Enable a feature to customize its shortcuts.',
  popup_placeholder_shortcut: 'Press keys',
  popup_label_navigation: 'Navigation',
  popup_label_action: 'Action',
  popup_message_load_failed: 'Failed to load synced settings. Showing defaults instead.',
  popup_message_conflict: '"$1" is already assigned to "$2".',
  popup_message_reserved: '"$1" is reserved for ChatGPT\'s "$2" action.',
  popup_message_chatgpt_conflict: '"$1" conflicts with ChatGPT\'s default "$2" shortcut.',
  popup_message_requires_modifier: '"$1" must be combined with a modifier key.',
  popup_message_forbidden_key: '"$1" cannot be used as a shortcut.',
  shortcut_label_scroll_top: 'Scroll to Top',
  shortcut_label_scroll_bottom: 'Scroll to Bottom',
  shortcut_label_scroll_up: 'Scroll Up',
  shortcut_label_scroll_down: 'Scroll Down',
  shortcut_label_scroll_half_up: 'Scroll Half Page Up',
  shortcut_label_scroll_half_down: 'Scroll Half Page Down',
  shortcut_label_toggle_focus: 'Toggle Focus',
  shortcut_label_toggle_model: 'Toggle Model Selector',
  shortcut_label_mode_auto: 'Set Mode: Auto',
  shortcut_label_mode_instant: 'Set Mode: Instant',
  shortcut_label_mode_thinking: 'Set Mode: Thinking',
  shortcut_label_temporary_chat: 'Open Temporary Chat',
  shortcut_panel_extension_heading: 'Extension',
  shortcut_panel_settings_label: 'Setting Shortcut Key',
  shortcut_panel_settings_link_text: 'Click here',
  notification_model_selector_missing: 'Model selector not found',
  notification_mode_item_missing: '"$1" menu item not found',
  notification_temporary_chat_missing: 'Temporary Chat button not found',
  notification_error_with_reason: 'Error: $1',
  error_unknown_mode: 'Unknown mode: $1',
  error_unknown_generic: 'Unknown error',
  error_timeout_generic: 'Timeout: Element not found',
  error_timeout_waiting: 'Timeout waiting for: $1',
  key_label_space: 'Space',
  key_label_enter: 'Enter',
  modifier_label_ctrl: 'Ctrl',
  modifier_label_cmd: 'Cmd',
  modifier_label_alt: 'Alt',
  modifier_label_option: 'Option',
  modifier_label_shift: 'Shift',
  chatgpt_shortcut_search_chats: 'Search chats',
  chatgpt_shortcut_open_new_chat: 'Open new chat',
  chatgpt_shortcut_toggle_sidebar: 'Toggle sidebar',
  chatgpt_shortcut_copy_last_code_block: 'Copy last code block',
  chatgpt_shortcut_next_message: 'Next message',
  chatgpt_shortcut_previous_message: 'Previous message',
  chatgpt_shortcut_delete_chat: 'Delete chat',
  chatgpt_shortcut_focus_input: 'Focus chat input',
  chatgpt_shortcut_add_files: 'Add photos & files',
  chatgpt_shortcut_toggle_dev_mode: 'Toggle dev mode',
  chatgpt_shortcut_show_shortcuts: 'Show shortcuts',
  chatgpt_shortcut_set_custom_instructions: 'Set custom instructions',
} as const;

export type MessageKey = keyof typeof FALLBACK_MESSAGES;

function applySubstitutions(message: string, substitutions?: (string | number)[]): string {
  if (!substitutions?.length) return message;
  return substitutions.reduce<string>(
    (acc, value, index) => acc.replaceAll(`$${index + 1}`, String(value)),
    message
  );
}

export function getMessage(key: MessageKey, substitutions?: (string | number)[]): string {
  const chromeMessage =
    typeof chrome !== 'undefined' && chrome?.i18n?.getMessage
      ? chrome.i18n.getMessage(
          key,
          substitutions?.map((value) => String(value))
        )
      : '';

  if (chromeMessage) {
    return chromeMessage;
  }

  const fallback = FALLBACK_MESSAGES[key];
  if (fallback) {
    return applySubstitutions(fallback, substitutions);
  }

  return key;
}

export function getMessageOrDefault(
  key: MessageKey,
  defaultValue: string,
  substitutions?: (string | number)[]
): string {
  const message = getMessage(key, substitutions);
  return message || defaultValue;
}

export function formatKeyName(key: string): string {
  if (key === ' ') return getMessage('key_label_space');
  if (key.toLowerCase() === 'enter') return getMessage('key_label_enter');
  return key;
}
