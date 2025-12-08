import { formatKeyName, getMessage } from './i18n';
import type { KeyBinding } from './settings';

export const isMacPlatform =
  typeof navigator !== 'undefined' && !!navigator.platform
    ? navigator.platform.toLowerCase().includes('mac')
    : false;

const CODE_KEY_MAP: Record<string, string> = {
  Space: ' ',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Escape: 'Escape',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

function codeToKeyName(code?: string): string | null {
  if (!code) return null;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length > 6) return code.slice(6);
  return CODE_KEY_MAP[code] || null;
}

function formatKeyToken(key: string): string {
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return map[key] || formatKeyName(key);
}

export function isModKey(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return isMacPlatform ? !!e.metaKey : !!e.ctrlKey;
}

export type NormalizedBinding = {
  key: string;
  code?: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
};

export function normalizeBinding(binding: KeyBinding): NormalizedBinding {
  const mod = binding.mod ?? binding.meta ?? false;
  const requiresOnlyMeta = binding.meta && binding.mod === false;
  const requiresOnlyCtrl = binding.ctrl && binding.mod !== true;

  return {
    key: binding.key,
    code: binding.code,
    mod,
    ctrl: (mod && !isMacPlatform) || !!requiresOnlyCtrl,
    meta: (mod && isMacPlatform) || !!requiresOnlyMeta,
    shift: !!binding.shift,
    alt: !!binding.alt,
  };
}

export function bindingMatchesEvent(binding: KeyBinding, e: KeyboardEvent): boolean {
  const normalized = normalizeBinding(binding);

  if (normalized.meta !== e.metaKey) return false;
  if (normalized.ctrl !== e.ctrlKey) return false;
  if (normalized.shift !== e.shiftKey) return false;
  if (normalized.alt !== e.altKey) return false;

  const keyMatch = e.key === binding.key || e.key.toLowerCase() === binding.key.toLowerCase();
  const codeMatch = binding.code ? e.code === binding.code : false;

  return keyMatch || codeMatch;
}

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  const na = normalizeBinding(a);
  const nb = normalizeBinding(b);

  const modifiersMatch =
    na.meta === nb.meta && na.ctrl === nb.ctrl && na.shift === nb.shift && na.alt === nb.alt;

  const keyMatch = a.key.toLowerCase() === b.key.toLowerCase();
  const codeMatch = a.code && b.code ? a.code === b.code : false;

  return modifiersMatch && (keyMatch || codeMatch);
}

export function getModLabel(): string {
  return isMacPlatform ? '⌘' : getMessage('modifier_label_ctrl');
}

export function getMetaLabel(): string {
  return isMacPlatform ? '⌘' : 'Win';
}

export function getCtrlLabel(): string {
  return isMacPlatform ? '⌃' : getMessage('modifier_label_ctrl');
}

export function getAltLabel(): string {
  return isMacPlatform ? '⌥' : getMessage('modifier_label_alt');
}

export function getShiftLabel(): string {
  return isMacPlatform ? '⇧' : getMessage('modifier_label_shift');
}

export function getKeyDisplayLabel(binding: KeyBinding): string {
  const prefersPhysicalKey = !!binding.alt;
  if (prefersPhysicalKey) {
    const fromCode = codeToKeyName(binding.code);
    if (fromCode) {
      return formatKeyToken(fromCode);
    }
  }
  return formatKeyToken(binding.key);
}

export function formatBindingTokens(binding: KeyBinding): string[] {
  const normalized = normalizeBinding(binding);
  const tokens: string[] = [];

  if (normalized.mod) {
    tokens.push(getModLabel());
  } else {
    if (normalized.meta) tokens.push(getMetaLabel());
    if (normalized.ctrl) tokens.push(getCtrlLabel());
  }

  if (normalized.alt) tokens.push(getAltLabel());
  if (normalized.shift) tokens.push(getShiftLabel());
  tokens.push(getKeyDisplayLabel(binding));

  return tokens;
}

export function formatBindingString(binding: KeyBinding): string {
  const separator = isMacPlatform ? ' ' : ' + ';
  return formatBindingTokens(binding).join(separator);
}
