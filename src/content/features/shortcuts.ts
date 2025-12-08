import { getMessage } from '@/shared/i18n';
import {
  bindingMatchesEvent,
  formatBindingTokens,
  isMacPlatform,
  isModKey,
} from '@/shared/keyboard';
import {
  ExtensionSettings,
  FeatureCategory,
  KeyBinding,
  ShortcutId,
  SHORTCUT_DEFINITIONS,
} from '@/shared/settings';

import { waitFor, humanClick, showNotification, getInputField } from './utils';

type ScrollType = 'top' | 'bottom' | 'up' | 'down' | 'halfUp' | 'halfDown';

export class ShortcutsManager {
  private scrollingDirection: 'up' | 'down' | null = null;
  private scrollingAnimationId: number | null = null;
  private scrollingContainer: Element | null = null;
  private scrollingKey: string | null = null;
  private readonly scrollingSpeed = 20; // px per frame (60fps = 300px/s)
  private switching = false;
  private settings: ExtensionSettings;
  private focusToggle: () => void;
  private defaultShortcutMap: Map<ShortcutId, KeyBinding[]>;

  constructor(settings: ExtensionSettings, focusToggle: () => void) {
    this.settings = settings;
    this.focusToggle = focusToggle;
    this.defaultShortcutMap = new Map(
      SHORTCUT_DEFINITIONS.map((def) => [def.id, def.defaultBindings])
    );
    this.bindKeys();
  }

  private notifyError(error: unknown) {
    const message = error instanceof Error ? error.message : getMessage('error_unknown_generic');
    showNotification(getMessage('notification_error_with_reason', [message]));
  }

  public updateSettings(settings: ExtensionSettings) {
    this.settings = settings;
    if (!this.isEnabled('vimScroll')) {
      this.stopContinuousScroll();
    }
    this.refreshShortcutPanel();
  }

  private isEnabled(category: FeatureCategory): boolean {
    return !!this.settings.featureToggles[category];
  }

  private getBindings(id: ShortcutId): KeyBinding[] {
    const hasCustomValue = Object.prototype.hasOwnProperty.call(this.settings.shortcuts, id);
    if (hasCustomValue) {
      const value = this.settings.shortcuts[id];
      if (Array.isArray(value)) {
        return value;
      }
    }
    return this.defaultShortcutMap.get(id) || [];
  }

  private matchesShortcut(id: ShortcutId, e: KeyboardEvent): boolean {
    const bindings = this.getBindings(id);
    return bindings.some((binding) => this.matchesBinding(binding, e));
  }

  private matchesBinding(binding: KeyBinding, e: KeyboardEvent): boolean {
    return bindingMatchesEvent(binding, e);
  }

  private isGptsPage(): boolean {
    return location.pathname.startsWith('/g/');
  }

  private async waitForElement(
    selector: string,
    options: {
      filter?: (el: Element) => boolean;
      timeout?: number;
    } = {}
  ): Promise<Element> {
    const { filter, timeout = 3000 } = options;

    return new Promise((resolve, reject) => {
      const pick = () => {
        const list = Array.from(document.querySelectorAll(selector));
        return filter ? list.find(filter) : list[0];
      };

      const found = pick();
      if (found) return resolve(found);

      const observer = new MutationObserver(() => {
        const el = pick();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(getMessage('error_timeout_waiting', [selector])));
      }, timeout);
    });
  }

  private async closeAllMenus(): Promise<void> {
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escapeEvent);

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  private async toggleModel() {
    try {
      if (this.isGptsPage()) {
        await this.closeAllMenus();
        await this.openGptsTriggerMenu();
        await this.openModelSubMenu();
        return;
      }

      const trigger = document.querySelector(
        'button[data-testid="model-switcher-dropdown-button"]'
      );

      if (!trigger) {
        showNotification(getMessage('notification_model_selector_missing'));
        return;
      }
      humanClick(trigger);
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private async openGptsTriggerMenu(): Promise<void> {
    const trigger = await this.waitForElement('#page-header [aria-haspopup="menu"]');

    humanClick(trigger);
  }

  private async openModelSubMenu(): Promise<void> {
    const modelMenuItem = await this.waitForElement(
      '[data-radix-menu-content] [role="menuitem"][data-has-submenu]'
    );

    humanClick(modelMenuItem);
  }

  private async clickModelItemForGpts(mode: string): Promise<void> {
    const testIdMap: Record<string, string> = {
      auto: 'model-switcher-gpt-5-1',
      instant: 'model-switcher-gpt-5-1-instant',
      thinking: 'model-switcher-gpt-5-1-thinking',
    };

    const testId = testIdMap[mode.toLowerCase()];
    if (!testId) throw new Error(getMessage('error_unknown_mode', [mode]));

    const item = await this.waitForElement(`[data-testid="${testId}"]`);
    humanClick(item);
  }

  private async selectModeForGpts(modeName: string): Promise<void> {
    if (this.switching) {
      return;
    }

    this.switching = true;

    try {
      await this.closeAllMenus();
      await this.openGptsTriggerMenu();
      await this.openModelSubMenu();
      await this.clickModelItemForGpts(modeName);

      setTimeout(() => {
        const input = getInputField();
        if (input) input.focus();
      }, 200);
    } catch (error: unknown) {
      this.notifyError(error);
    } finally {
      this.switching = false;
    }
  }

  private async selectMode(modeName: string) {
    try {
      if (this.isGptsPage()) {
        await this.selectModeForGpts(modeName);
        return;
      }

      await this.closeAllMenus();

      const trigger = document.querySelector(
        'header[id="page-header"] button[data-testid="model-switcher-dropdown-button"]'
      );

      if (!trigger) {
        showNotification(getMessage('notification_model_selector_missing'));
        return;
      }
      humanClick(trigger);

      const selectorMap: Record<string, string> = {
        auto: '[data-testid="model-switcher-gpt-5-1"]',
        instant: '[data-testid="model-switcher-gpt-5-1-instant"]',
        thinking: '[data-testid="model-switcher-gpt-5-1-thinking"]',
      };

      const selector = selectorMap[modeName.toLowerCase()];
      if (!selector) {
        showNotification(getMessage('notification_mode_item_missing', [modeName]));
        return;
      }

      const item = await this.waitForElement(selector);

      if (!item) {
        showNotification(getMessage('notification_mode_item_missing', [modeName]));
        return;
      }
      humanClick(item);
      setTimeout(() => {
        const input = getInputField();
        if (input) input.focus();
      }, 200);
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private async openTemporaryChat() {
    try {
      const tmpChatButton = document.querySelector(
        '#conversation-header-actions > div > span[data-state] > button.no-draggable'
      );
      if (!tmpChatButton) {
        showNotification(getMessage('notification_temporary_chat_missing'));
        return;
      }
      humanClick(tmpChatButton);
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private startContinuousScroll(container: Element, direction: 'up' | 'down') {
    this.stopContinuousScroll();

    this.scrollingDirection = direction;
    this.scrollingContainer = container;

    const scroll = () => {
      if (this.scrollingDirection === direction && this.scrollingContainer) {
        const delta = direction === 'up' ? -this.scrollingSpeed : this.scrollingSpeed;
        this.scrollingContainer.scrollTop += delta;
        this.scrollingAnimationId = requestAnimationFrame(scroll);
      }
    };

    this.scrollingAnimationId = requestAnimationFrame(scroll);
  }

  private stopContinuousScroll() {
    this.scrollingDirection = null;
    this.scrollingContainer = null;
    if (this.scrollingAnimationId !== null) {
      cancelAnimationFrame(this.scrollingAnimationId);
      this.scrollingAnimationId = null;
    }
  }

  private animateScroll(container: Element, targetTop: number, duration: number) {
    const start = container.scrollTop;
    const change = targetTop - start;
    const startTime = performance.now();

    const easeInOutQuad = (t: number): number => {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    };

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = easeInOutQuad(progress);

      container.scrollTop = start + change * easeProgress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  private handleVimScroll(e: KeyboardEvent, type: ScrollType): boolean {
    const ae = document.activeElement;
    const isEditable =
      ae &&
      ((ae instanceof HTMLElement && ae.isContentEditable) ||
        /^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName));

    if (isEditable) return false;

    const huge =
      document.querySelector('div.flex.flex-col.text-sm.thread-xl\\:pt-header-height.pb-25') ||
      document.querySelector('div.flex.flex-col.text-sm');

    let container: Element = document.scrollingElement || document.documentElement || document.body;
    if (huge) {
      let cur = huge;
      while (cur && cur !== document.body) {
        const st = getComputedStyle(cur);
        if (/(auto|scroll)/.test(st.overflowY) && cur.scrollHeight > cur.clientHeight + 8) {
          container = cur;
          break;
        }
        cur = cur.parentElement as Element;
      }
    }

    e.preventDefault();
    e.stopPropagation();

    const STEP = 60;
    const STEP_REPEAT = 15;
    const DURATION_FAST = 100;
    const DURATION_SMOOTH = 200;

    let targetTop: number;

    switch (type) {
      case 'top':
        targetTop = 0;
        break;
      case 'bottom':
        targetTop = container.scrollHeight - container.clientHeight;
        break;
      case 'up':
        targetTop = container.scrollTop - (e.repeat ? STEP_REPEAT : STEP);
        break;
      case 'down':
        targetTop = container.scrollTop + (e.repeat ? STEP_REPEAT : STEP);
        break;
      case 'halfUp':
        targetTop = container.scrollTop - window.innerHeight / 2;
        break;
      case 'halfDown':
        targetTop = container.scrollTop + window.innerHeight / 2;
        break;
      default:
        return false;
    }

    targetTop = Math.max(0, Math.min(targetTop, container.scrollHeight - container.clientHeight));

    if (type === 'up' || type === 'down') {
      if (!e.repeat) {
        this.animateScroll(container, targetTop, DURATION_FAST);
        this.scrollingKey = e.key;
        setTimeout(() => {
          if (this.scrollingKey === e.key && this.scrollingDirection === null) {
            this.startContinuousScroll(container, type);
          }
        }, DURATION_FAST);
      } else if (this.scrollingDirection === null) {
        this.startContinuousScroll(container, type);
      }
    } else {
      if (e.repeat) {
        container.scrollTop = targetTop;
      } else {
        this.animateScroll(container, targetTop, DURATION_SMOOTH);
      }
    }

    return true;
  }

  private handleEnterKey(e: KeyboardEvent): boolean {
    if (!this.isEnabled('safeSend')) return false;
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return false;
    }

    const input = getInputField();
    if (!input || document.activeElement !== input || e.isComposing) return false;

    e.preventDefault();
    e.stopImmediatePropagation();

    const shiftEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      which: 13,
      keyCode: 13,
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    input.dispatchEvent(shiftEnter);
    return true;
  }

  private bindKeys() {
    document.addEventListener('keyup', (e) => {
      if (e.key === this.scrollingKey) {
        this.stopContinuousScroll();
        this.scrollingKey = null;
      }
    });

    document.addEventListener('keydown', (e) => this.handleKeydown(e), true);
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.handleEnterKey(e)) return;

    if (this.isEnabled('vimScroll')) {
      if (this.matchesShortcut('scrollTop', e) && this.handleVimScroll(e, 'top')) return;
      if (this.matchesShortcut('scrollBottom', e) && this.handleVimScroll(e, 'bottom')) return;
      if (this.matchesShortcut('scrollHalfUp', e) && this.handleVimScroll(e, 'halfUp')) return;
      if (this.matchesShortcut('scrollHalfDown', e) && this.handleVimScroll(e, 'halfDown')) return;
      if (this.matchesShortcut('scrollUp', e) && this.handleVimScroll(e, 'up')) return;
      if (this.matchesShortcut('scrollDown', e) && this.handleVimScroll(e, 'down')) return;
    }

    if (this.isEnabled('wideScreen') && this.matchesShortcut('toggleFocus', e)) {
      e.preventDefault();
      this.focusToggle();
      return;
    }

    if (isModKey(e) && e.key === '/') {
      setTimeout(() => this.ensureShortcutPanelPatched(), 100);
    }

    if (!this.isEnabled('otherShortcuts')) return;

    if (this.matchesShortcut('toggleModel', e)) {
      e.preventDefault();
      this.toggleModel();
      return;
    }

    if (this.matchesShortcut('modeAuto', e)) {
      e.preventDefault();
      this.selectMode('Auto');
      return;
    }

    if (this.matchesShortcut('modeInstant', e)) {
      e.preventDefault();
      this.selectMode('Instant');
      return;
    }

    if (this.matchesShortcut('modeThinking', e)) {
      e.preventDefault();
      this.selectMode('Thinking');
      return;
    }

    if (this.matchesShortcut('temporaryChat', e)) {
      e.preventDefault();
      this.openTemporaryChat();
      return;
    }
  }

  private async ensureShortcutPanelPatched() {
    try {
      const panel = await waitFor(() => this.findShortcutPanel(), { timeout: 800, retries: 3 });

      if (panel) {
        this.decorateShortcutPanel(panel as HTMLElement);
      }
    } catch {
      // Silently ignore errors if panel decoration fails
    }
  }

  private findShortcutPanel(): HTMLElement | null {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    for (let i = dialogs.length - 1; i >= 0; i -= 1) {
      const dialog = dialogs[i];
      const hasShortcutList = !!dialog.querySelector('dl');
      const hasKeyHints = !!dialog.querySelector('kbd');
      if (hasShortcutList && hasKeyHints) {
        return dialog;
      }
    }

    const popovers = Array.from(
      document.querySelectorAll<HTMLElement>('.popover, [role="menu"], [data-radix-menu-content]')
    );
    for (let i = popovers.length - 1; i >= 0; i -= 1) {
      const popover = popovers[i];
      const hasShortcutList = !!popover.querySelector('dl');
      const hasKeyHints = !!popover.querySelector('kbd');
      if (hasShortcutList && hasKeyHints) {
        const dialog = popover.closest('[role="dialog"]') as HTMLElement | null;
        return dialog || popover;
      }
    }

    return null;
  }

  private refreshShortcutPanel() {
    const panel = this.findShortcutPanel();
    if (panel) {
      this.decorateShortcutPanel(panel);
    }
  }

  private decorateShortcutPanel(panel: HTMLElement) {
    const root = (panel.closest('[role="dialog"]') as HTMLElement | null) || panel;
    const list = root.querySelector('dl') as HTMLElement | null;
    const scrollHost = list || root;

    scrollHost.style.maxHeight = '70vh';
    scrollHost.style.overflowY = 'auto';
    scrollHost.style.scrollbarWidth = 'thin';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scrollHost.style as any).webkitOverflowScrolling = 'touch';

    if (!scrollHost.dataset.customScrollBound) {
      const stop = (ev: Event) => ev.stopPropagation();
      ['mousedown', 'pointerdown', 'click', 'wheel'].forEach((evt) =>
        scrollHost.addEventListener(evt, stop, { passive: evt === 'wheel' })
      );
      scrollHost.dataset.customScrollBound = 'true';
    }

    this.addCustomShortcutsToMenu(root);
    root.dataset.customShortcutsInjected = 'true';
  }

  private bindingToTokens(binding: KeyBinding): string[] {
    return formatBindingTokens(binding);
  }

  private createKbdGroup(tokens: string[]): HTMLElement {
    const keysDiv = document.createElement('div');
    keysDiv.className =
      'chatgpt-unified-keycap-row inline-flex items-center gap-1 whitespace-pre *:font-sans';
    tokens.forEach((token, index) => {
      const kbd = document.createElement('kbd');
      kbd.className = 'chatgpt-unified-keycap';
      kbd.textContent = token;
      keysDiv.appendChild(kbd);
      if (!isMacPlatform && index < tokens.length - 1) {
        const plus = document.createElement('span');
        plus.className = 'chatgpt-unified-keycap-sep';
        plus.textContent = '+';
        keysDiv.appendChild(plus);
      }
    });
    return keysDiv;
  }

  private getDisplayBindings(def: {
    id: ShortcutId;
    defaultBindings: KeyBinding[];
    category: FeatureCategory;
  }): KeyBinding[] {
    const enabled = this.isEnabled(def.category);
    if (!enabled) return def.defaultBindings;
    const value = this.settings.shortcuts[def.id];
    if (Array.isArray(value) && value.length) return value;
    return def.defaultBindings;
  }

  private addCustomShortcutsToMenu(menuContainer: Element) {
    const dl = menuContainer.querySelector('dl');
    if (!dl) return;

    dl.querySelectorAll('[data-custom-shortcut="true"]').forEach((el) => el.remove());

    const extensionDefs = SHORTCUT_DEFINITIONS.filter((def) => this.isEnabled(def.category));

    // Use DocumentFragment to add all elements at once
    const fragment = document.createDocumentFragment();

    const categoryDt = document.createElement('dt');
    categoryDt.className = 'text-token-text-tertiary col-span-2 mt-2 empty:hidden';
    categoryDt.textContent = getMessage('shortcut_panel_extension_heading');
    categoryDt.dataset.customShortcut = 'true';
    fragment.appendChild(categoryDt);

    const settingsDt = document.createElement('dt');
    settingsDt.textContent = getMessage('shortcut_panel_settings_label');
    settingsDt.dataset.customShortcut = 'true';

    const settingsDd = document.createElement('dd');
    settingsDd.className = 'text-token-text-secondary justify-self-end';
    settingsDd.dataset.customShortcut = 'true';

    const settingsLink = document.createElement('a');
    settingsLink.href = '#';
    settingsLink.textContent = getMessage('shortcut_panel_settings_link_text');
    settingsLink.style.color = 'inherit';
    settingsLink.style.textDecoration = 'underline';

    const openSettingsPage = () => {
      chrome.runtime.sendMessage({ action: 'openSettings' });
    };

    settingsLink.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openSettingsPage();
    });

    settingsDd.appendChild(settingsLink);
    fragment.appendChild(settingsDt);
    fragment.appendChild(settingsDd);

    if (extensionDefs.length) {
      extensionDefs.forEach((def) => {
        const bindings = this.getDisplayBindings(def);
        if (!bindings.length) return;

        const labelDt = document.createElement('dt');
        labelDt.textContent = getMessage(def.labelKey);
        labelDt.dataset.customShortcut = 'true';

        const keysDd = document.createElement('dd');
        keysDd.className = 'text-token-text-secondary justify-self-end';
        keysDd.dataset.customShortcut = 'true';

        bindings.forEach((binding, index) => {
          const group = this.createKbdGroup(this.bindingToTokens(binding));
          if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'mx-1';
            sep.textContent = '/';
            keysDd.appendChild(sep);
          }
          keysDd.appendChild(group);
        });

        fragment.appendChild(labelDt);
        fragment.appendChild(keysDd);
      });
    }

    // Add all elements to the DOM at once
    dl.appendChild(fragment);
  }
}
