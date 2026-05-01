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
type ModeName = 'instant' | 'thinking' | 'pro';
type ScrollSnapshotEntry = {
  container: Element;
  scrollTop: number;
};
type ScrollSnapshot = ScrollSnapshotEntry[];
type ScrollRestoreMode = 'focusAfterHidden' | 'immediate';

export class ShortcutsManager {
  private scrollingDirection: 'up' | 'down' | null = null;
  private scrollingAnimationId: number | null = null;
  private scrollingContainer: Element | null = null;
  private scrollingKey: string | null = null;
  private readonly scrollingSpeed = 20; // px per frame (60fps = 300px/s)
  private scrollRestoreCleanup: (() => void) | null = null;
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

  private normalizeModeName(modeName: string): ModeName | null {
    const normalized = modeName.trim().toLowerCase();
    if (normalized === 'instant' || normalized === 'thinking' || normalized === 'pro') {
      return normalized;
    }
    return null;
  }

  private getOpenMenuRoot(): HTMLElement | null {
    const menus = this.getOpenMenuRoots();
    return menus[menus.length - 1] || null;
  }

  private getOpenMenuRoots(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-radix-menu-content][data-state="open"], [role="menu"][data-state="open"]'
      )
    );
  }

  private waitForMenuClosed(menu: HTMLElement, timeout = 15000): Promise<boolean> {
    return new Promise((resolve) => {
      if (!menu.isConnected || menu.getAttribute('data-state') !== 'open') {
        resolve(true);
        return;
      }

      let finished = false;
      const finalize = (closed: boolean) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(closed);
      };

      const observer = new MutationObserver(() => {
        if (!menu.isConnected || menu.getAttribute('data-state') !== 'open') {
          finalize(true);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state'],
      });

      const timer = window.setTimeout(() => finalize(false), timeout);
    });
  }

  private async focusInputAfterMenuClose() {
    let menu: HTMLElement | null = null;
    try {
      menu = (await waitFor(() => this.getOpenMenuRoot(), { timeout: 2000 })) as HTMLElement;
    } catch {
      return;
    }

    if (!menu) return;

    const closed = await this.waitForMenuClosed(menu);
    if (!closed) return;

    setTimeout(() => {
      const input = getInputField();
      if (input) input.focus();
    }, 200);
  }

  private itemTextMatchesMode(item: HTMLElement, mode: ModeName): boolean {
    const text = this.normalizeMenuLabel(
      `${item.getAttribute('aria-label') || ''} ${item.textContent || ''}`
    );
    return new RegExp(`(^|\\b)${mode}(\\b|$)`).test(text);
  }

  private isModelSwitcherItem(item: HTMLElement): boolean {
    const testId = item.getAttribute('data-testid') ?? '';
    return testId.startsWith('model-switcher-') && !testId.startsWith('model-switcher-dropdown');
  }

  private itemTestIdMatchesMode(item: HTMLElement, mode: ModeName): boolean {
    const testId = item.getAttribute('data-testid') ?? '';
    if (!this.isModelSwitcherItem(item)) return false;
    if (mode === 'thinking') return /(?:^|-)thinking$/.test(testId);
    if (mode === 'pro') return /(?:^|-)pro$/.test(testId);
    return !/(?:^|-)(thinking|pro)$/.test(testId);
  }

  private isIntelligenceDialog(dialog: HTMLElement): boolean {
    const title = this.normalizeMenuLabel(
      Array.from(dialog.querySelectorAll('h1, h2, h3, [id]'))
        .map((element) => element.textContent || '')
        .join(' ')
    );
    const hasModelOptions =
      !!dialog.querySelector('[role="radiogroup"][aria-label="Model options"]') ||
      !!dialog.querySelector('#model-selection-label');

    return hasModelOptions && title.includes('intelligence');
  }

  private getOpenModelRoots(): HTMLElement[] {
    const roots = new Set<HTMLElement>();
    this.getOpenMenuRoots().forEach((menu) => roots.add(menu));

    document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]').forEach((dialog) => {
      if (
        dialog.getAttribute('data-state') !== 'closed' &&
        this.isVisibleElement(dialog) &&
        this.isIntelligenceDialog(dialog)
      ) {
        roots.add(dialog);
      }
    });

    return Array.from(roots);
  }

  private isDisabledElement(element: HTMLElement): boolean {
    return (
      (element instanceof HTMLButtonElement && element.disabled) ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.hasAttribute('data-disabled')
    );
  }

  private isVisibleElement(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  }

  private isUsableElement(element: HTMLElement): boolean {
    return this.isVisibleElement(element) && !this.isDisabledElement(element);
  }

  private findModeItemInRoot(root: HTMLElement, mode: ModeName): HTMLElement | null {
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"], [role="radio"]'
      )
    ).filter((item) => this.isUsableElement(item));
    const modelItems = items.filter((item) => this.isModelSwitcherItem(item));
    const byTestId = modelItems.find((item) => this.itemTestIdMatchesMode(item, mode));
    if (byTestId) return byTestId;

    const radioGroup = root.querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Model options"]'
    );
    const radioItems = radioGroup
      ? Array.from(radioGroup.querySelectorAll<HTMLElement>('[role="radio"]')).filter((item) =>
          this.isUsableElement(item)
        )
      : items.filter((item) => item.getAttribute('role') === 'radio');

    return (
      modelItems.find((item) => this.itemTextMatchesMode(item, mode)) ||
      radioItems.find((item) => this.itemTextMatchesMode(item, mode)) ||
      items.find((item) => this.itemTextMatchesMode(item, mode)) ||
      null
    );
  }

  private findModeMenuItem(mode: ModeName): HTMLElement | null {
    const roots = this.getOpenModelRoots();
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      const item = this.findModeItemInRoot(roots[index], mode);
      if (item) return item;
    }
    return null;
  }

  private async waitForModeMenuItem(mode: ModeName): Promise<HTMLElement | null> {
    try {
      const item = await waitFor(() => this.findModeMenuItem(mode), { timeout: 3000 });
      return item as HTMLElement;
    } catch {
      return null;
    }
  }

  private async clickModeItem(modeName: string, notifyOnMissing = true): Promise<boolean> {
    const mode = this.normalizeModeName(modeName);
    if (!mode) {
      throw new Error(getMessage('error_unknown_mode', [modeName]));
    }

    const item = await this.waitForModeMenuItem(mode);
    if (!item) {
      if (notifyOnMissing) {
        showNotification(getMessage('notification_mode_item_missing', [modeName]));
      }
      return false;
    }
    humanClick(item);
    return true;
  }

  private async toggleModel() {
    try {
      if (this.isGptsPage()) {
        await this.closeAllMenus();
        await this.openGptsTriggerMenu();
        await this.openModelSubMenu();
        void this.focusInputAfterMenuClose();
        return;
      }

      const trigger = this.findModelSelectorButton();

      if (!trigger) {
        showNotification(getMessage('notification_model_selector_missing'));
        return;
      }
      humanClick(trigger);
      void this.focusInputAfterMenuClose();
    } catch (error: unknown) {
      this.clearScrollRestore();
      this.notifyError(error);
    }
  }

  private findModelSelectorButton(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('button[data-testid="model-switcher-dropdown-button"]') ||
      document.querySelector<HTMLElement>('button[aria-label="Model selector"]') ||
      this.findComposerModelSelectorButton()
    );
  }

  private findComposerModelSelectorButton(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          '#thread-bottom-container button.__composer-pill[aria-haspopup="menu"]',
          '#thread-bottom-container [data-composer-surface="true"] button[aria-haspopup="menu"]',
          'form[data-type="unified-composer"] button[aria-haspopup="menu"]',
          'button.__composer-pill[aria-haspopup="menu"]',
        ].join(', ')
      )
    );
    const seen = new Set<HTMLElement>();

    return (
      candidates
        .filter((candidate) => {
          if (seen.has(candidate)) return false;
          seen.add(candidate);
          return true;
        })
        .find((candidate) => this.isLikelyComposerModelSelectorButton(candidate)) || null
    );
  }

  private isLikelyComposerModelSelectorButton(button: HTMLElement): boolean {
    if (!this.isUsableElement(button)) return false;

    const testId = button.getAttribute('data-testid') || '';
    if (testId === 'composer-plus-btn' || testId.includes('plus')) return false;

    const label = this.normalizeMenuLabel(
      `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`
    );
    if (
      label.includes('add files') ||
      label.includes('dictation') ||
      label.includes('voice') ||
      label.includes('search')
    ) {
      return false;
    }

    if (button.classList.contains('__composer-pill')) return true;

    const isInComposer = !!button.closest(
      '#thread-bottom-container, [data-composer-surface="true"], form[data-type="unified-composer"]'
    );
    return isInComposer && /\b(instant|thinking|pro|latest|extended|auto)\b/.test(label);
  }

  private findModelConfigureItem(): HTMLElement | null {
    const root = this.getOpenMenuRoot();
    if (!root) return null;

    return (
      root.querySelector<HTMLElement>('[data-testid="model-configure-modal"]') ||
      Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
        this.normalizeMenuLabel(item.textContent || '').includes('configure')
      ) ||
      null
    );
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
    await this.clickModeItem(mode);
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

      const trigger = this.findModelSelectorButton();

      if (!trigger) {
        showNotification(getMessage('notification_model_selector_missing'));
        return;
      }
      humanClick(trigger);
      let selected = await this.clickModeItem(modeName, false);
      if (!selected) {
        const configureItem = await waitFor(() => this.findModelConfigureItem(), {
          timeout: 1200,
        }).catch(() => null);
        if (configureItem) {
          humanClick(configureItem);
          selected = await this.clickModeItem(modeName, false);
        }
      }
      if (!selected) {
        showNotification(getMessage('notification_mode_item_missing', [modeName]));
        return;
      }

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
      let tmpChatButton = this.findTemporaryChatButton();
      if (tmpChatButton) {
        if (!this.isTemporaryChatEnabledButton(tmpChatButton)) {
          humanClick(tmpChatButton);
        }
        return;
      }

      const newChatButton = this.findNewChatButton();
      if (!newChatButton) {
        showNotification(getMessage('notification_temporary_chat_missing'));
        return;
      }

      humanClick(newChatButton);
      tmpChatButton = (await waitFor(() => this.findTemporaryChatButton(), {
        timeout: 5000,
      }).catch(() => null)) as HTMLElement | null;
      if (!tmpChatButton) {
        showNotification(getMessage('notification_temporary_chat_missing'));
        return;
      }
      if (this.isTemporaryChatEnabledButton(tmpChatButton)) return;
      humanClick(tmpChatButton);
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private findTemporaryChatButton(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          'button[data-testid*="temporary" i]',
          'button[aria-label*="temporary" i]',
          '[role="menuitem"][data-testid*="temporary" i]',
          '[role="menuitem"][aria-label*="temporary" i]',
          '#conversation-header-actions > div > span[data-state] > button.no-draggable',
        ].join(', ')
      )
    );
    const temporaryCandidates = candidates.filter((candidate) =>
      this.normalizeMenuLabel(
        `${candidate.getAttribute('aria-label') || ''} ${candidate.textContent || ''}`
      ).includes('temporary')
    );

    return (
      temporaryCandidates.find(
        (candidate) =>
          !this.isTemporaryChatEnabledButton(candidate) && this.isUsableElement(candidate)
      ) ||
      temporaryCandidates.find((candidate) => this.isUsableElement(candidate)) ||
      null
    );
  }

  private isTemporaryChatEnabledButton(button: HTMLElement): boolean {
    const label = this.normalizeMenuLabel(
      `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`
    );
    return (
      label.includes('turn off temporary') ||
      label.includes('temporary chat is on') ||
      button.getAttribute('aria-pressed') === 'true'
    );
  }

  private findNewChatButton(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          '[data-testid="create-new-chat-button"]',
          'a[href="/"][data-sidebar-item="true"]',
          'a[href="/"]',
          'button[aria-label*="new chat" i]',
        ].join(', ')
      )
    );
    const seen = new Set<HTMLElement>();

    return (
      candidates
        .filter((candidate) => {
          if (seen.has(candidate)) return false;
          seen.add(candidate);
          return this.isUsableElement(candidate);
        })
        .find((candidate) =>
          this.normalizeMenuLabel(
            `${candidate.getAttribute('aria-label') || ''} ${candidate.textContent || ''}`
          ).includes('new chat')
        ) || null
    );
  }

  private findConversationMenuTrigger(): HTMLElement | null {
    const container = document.querySelector('#conversation-header-actions');
    if (!container) return null;

    const trigger =
      container.querySelector<HTMLElement>('button[data-testid="conversation-options-button"]') ||
      container.querySelector<HTMLElement>('button[aria-label="Open conversation options"]') ||
      container.querySelector<HTMLElement>('[aria-haspopup="menu"][data-state]') ||
      container.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
    if (!trigger) return null;

    if (trigger instanceof HTMLButtonElement) return trigger;
    return trigger.querySelector<HTMLElement>('button') || trigger;
  }

  private normalizeMenuLabel(label: string): string {
    return label.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private findPinToggleMenuItem(
    menu: HTMLElement
  ): { item: HTMLElement; action: 'pin' | 'unpin' } | null {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const localizedPin = this.normalizeMenuLabel(getMessage('notification_pin_chat'));
    const localizedUnpin = this.normalizeMenuLabel(getMessage('notification_unpin_chat'));
    const normalized = items.map((item) => ({
      item,
      label: this.normalizeMenuLabel(item.textContent || ''),
    }));

    const unpinItem = normalized.find(
      (entry) => entry.label === 'unpin chat' || entry.label === localizedUnpin
    );
    if (unpinItem) return { item: unpinItem.item, action: 'unpin' };

    const pinItem = normalized.find(
      (entry) => entry.label === 'pin chat' || entry.label === localizedPin
    );
    if (pinItem) return { item: pinItem.item, action: 'pin' };

    return null;
  }

  private async togglePinChat() {
    try {
      await this.closeAllMenus();

      const trigger = this.findConversationMenuTrigger();
      if (!trigger) {
        showNotification(getMessage('notification_conversation_menu_missing'));
        return;
      }

      humanClick(trigger);
      const menu = (await waitFor(() => this.getOpenMenuRoot(), { timeout: 2000 })) as HTMLElement;
      if (!menu) {
        showNotification(getMessage('notification_conversation_menu_missing'));
        return;
      }

      const target = this.findPinToggleMenuItem(menu);
      if (!target) {
        showNotification(getMessage('notification_pin_menu_item_missing'));
        return;
      }

      void this.focusInputAfterMenuClose();
      humanClick(target.item);

      showNotification(
        getMessage(target.action === 'pin' ? 'notification_pin_chat' : 'notification_unpin_chat'),
        'success'
      );
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private getConversationTurns(role: 'assistant' | 'user'): HTMLElement[] {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          `[data-testid^="conversation-turn-"][data-turn="${role}"]`,
          `section[data-turn="${role}"]`,
          `article[data-turn="${role}"]`,
          `[data-message-author-role="${role}"]`,
        ].join(', ')
      )
    );
    const turns = new Set<HTMLElement>();

    candidates.forEach((candidate) => {
      const turn =
        (candidate.matches(`[data-turn="${role}"]`) ? candidate : null) ||
        candidate.closest<HTMLElement>(`[data-turn="${role}"]`) ||
        candidate.closest<HTMLElement>('[data-testid^="conversation-turn-"]') ||
        candidate.closest<HTMLElement>('article, section') ||
        candidate;

      if (turn.isConnected) {
        turns.add(turn);
      }
    });

    return Array.from(turns);
  }

  private getLastConversationTurn(role: 'assistant' | 'user'): HTMLElement | null {
    const turns = this.getConversationTurns(role);
    return turns[turns.length - 1] || null;
  }

  private async branchChat(): Promise<void> {
    try {
      await this.closeAllMenus();

      const lastAssistantTurn = this.getLastConversationTurn('assistant');
      if (!lastAssistantTurn) {
        showNotification(getMessage('notification_branch_chat_not_found'));
        return;
      }

      const moreActionsBtn =
        lastAssistantTurn.querySelector<HTMLElement>('button[aria-label="More actions"]') ||
        lastAssistantTurn.querySelector<HTMLElement>('button[aria-label*="More" i]') ||
        lastAssistantTurn.querySelector<HTMLElement>('button[data-testid*="more" i]') ||
        lastAssistantTurn.querySelector<HTMLElement>('button[data-testid*="turn-actions" i]');
      if (!moreActionsBtn) {
        showNotification(getMessage('notification_branch_chat_not_found'));
        return;
      }

      const scrollSnapshot = this.captureScrollSnapshot();
      this.scheduleScrollRestore(scrollSnapshot, 'focusAfterHidden');

      humanClick(moreActionsBtn, { scroll: false });

      const branchItem = await waitFor(() => this.findMenuItemByLabel('branch'), {
        timeout: 2000,
      });
      humanClick(branchItem, { scroll: false });
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private copyLastUserMessage() {
    try {
      const lastUserTurn = this.getLastConversationTurn('user');
      if (!lastUserTurn) {
        showNotification(getMessage('notification_copy_last_user_message_missing'));
        return;
      }

      const copyButton =
        lastUserTurn.querySelector<HTMLElement>('button[data-testid="copy-turn-action-button"]') ||
        lastUserTurn.querySelector<HTMLElement>('button[data-testid*="copy" i]') ||
        lastUserTurn.querySelector<HTMLElement>('button[aria-label="Copy"]') ||
        lastUserTurn.querySelector<HTMLElement>('button[aria-label*="Copy" i]');
      if (!copyButton) {
        showNotification(getMessage('notification_copy_last_user_message_missing'));
        return;
      }

      humanClick(copyButton, { scroll: false });
      showNotification(getMessage('notification_copy_last_user_message_success'), 'success');
    } catch (error: unknown) {
      this.notifyError(error);
    }
  }

  private findMenuItemByLabel(labelPart: string): HTMLElement | null {
    const normalizedNeedle = this.normalizeMenuLabel(labelPart);
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
    );
    return (
      items.find((item) =>
        this.normalizeMenuLabel(
          `${item.getAttribute('aria-label') || ''} ${item.textContent || ''}`
        ).includes(normalizedNeedle)
      ) || null
    );
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

  private clearScrollRestore() {
    if (this.scrollRestoreCleanup) {
      this.scrollRestoreCleanup();
      this.scrollRestoreCleanup = null;
    }
  }

  private getScrollContainer(): Element {
    const huge =
      document.querySelector('div.flex.flex-col.text-sm.thread-xl\\:pt-header-height.pb-25') ||
      document.querySelector('div.flex.flex-col.text-sm');

    let container: Element = document.scrollingElement || document.documentElement || document.body;
    if (huge) {
      let cur: Element | null = huge;
      while (cur && cur !== document.body) {
        const st = getComputedStyle(cur);
        if (/(auto|scroll)/.test(st.overflowY) && cur.scrollHeight > cur.clientHeight + 8) {
          container = cur;
          break;
        }
        cur = cur.parentElement;
      }
    }

    return container;
  }

  private collectScrollableAncestors(from: Element | null, targets: Set<Element>) {
    let current: Element | null = from;
    while (current) {
      const style = getComputedStyle(current);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight + 8
      ) {
        targets.add(current);
      }
      current = current.parentElement;
    }
  }

  private getScrollContainers(): Element[] {
    const targets = new Set<Element>();
    const primary = this.getScrollContainer();
    const rootScroller = document.scrollingElement || document.documentElement || document.body;

    if (rootScroller) targets.add(rootScroller);
    if (primary) targets.add(primary);

    const input = getInputField();
    if (input) {
      this.collectScrollableAncestors(input, targets);
    }

    const main = document.querySelector('main');
    if (main) {
      this.collectScrollableAncestors(main, targets);
    }

    return Array.from(targets);
  }

  private captureScrollSnapshot(): ScrollSnapshot {
    return this.getScrollContainers().map((container) => ({
      container,
      scrollTop: container.scrollTop,
    }));
  }

  private preserveScrollOnSend() {
    if (!this.isEnabled('preserveScrollOnSend')) return;
    const snapshot = this.captureScrollSnapshot();
    this.scheduleScrollRestore(snapshot, 'immediate');
  }

  private isInputFocused(input: HTMLElement): boolean {
    const active = document.activeElement;
    return !!active && (active === input || input.contains(active));
  }

  private isKeyboardSend(e: KeyboardEvent): boolean {
    if (e.key !== 'Enter' || e.isComposing || e.repeat || e.altKey || e.shiftKey) {
      return false;
    }

    const input = getInputField();
    if (!input || !this.isInputFocused(input)) return false;

    if (e.ctrlKey || e.metaKey) return true;
    return !this.isEnabled('safeSend');
  }

  private isComposerForm(form: HTMLFormElement): boolean {
    const input = getInputField();
    if (input && form.contains(input)) return true;

    return !!form.querySelector(
      'div.ProseMirror[contenteditable="true"], textarea, [data-testid*="send"]'
    );
  }

  private isWithinComposer(element: Element): boolean {
    const input = getInputField();
    if (!input) return false;

    const inputForm = input.closest('form');
    const targetForm = element.closest('form');
    if (inputForm && targetForm && inputForm === targetForm) return true;

    const composerContainer = input.closest('#thread-bottom-container');
    return !!composerContainer && composerContainer.contains(element);
  }

  private isSendButton(button: HTMLButtonElement): boolean {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;

    const type = (button.getAttribute('type') || '').toLowerCase();
    const form = button.closest('form');
    if (
      form instanceof HTMLFormElement &&
      this.isComposerForm(form) &&
      (type === '' || type === 'submit')
    ) {
      return true;
    }

    if (!this.isWithinComposer(button)) return false;

    const testId = (button.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('send')) return true;

    const label = (button.getAttribute('aria-label') || '').toLowerCase();
    const title = (button.getAttribute('title') || '').toLowerCase();
    return (
      label.includes('send') ||
      label.includes('submit') ||
      title.includes('send') ||
      title.includes('submit')
    );
  }

  private handleDocumentClick(e: MouseEvent) {
    if (!this.isEnabled('preserveScrollOnSend')) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement)) return;
    if (!this.isSendButton(button)) return;

    this.preserveScrollOnSend();
  }

  private handleDocumentSubmit(e: Event) {
    if (!this.isEnabled('preserveScrollOnSend')) return;

    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!this.isComposerForm(form)) return;

    this.preserveScrollOnSend();
  }

  private scheduleScrollRestore(
    snapshot: ScrollSnapshot,
    mode: ScrollRestoreMode = 'focusAfterHidden'
  ) {
    this.clearScrollRestore();

    if (!snapshot.length) return;

    let active = true;
    let restored = false;
    let wasHidden = document.hidden;
    const timeouts: number[] = [];
    const BURST_DURATION = 1500;
    const IMMEDIATE_RESTORE_TIMINGS = [0, 40, 80, 140, 220, 320, 460, 640, 860, 1150];

    const restore = () => {
      if (!active) return;
      snapshot.forEach((entry) => {
        if (!entry.container.isConnected) return;
        entry.container.scrollTop = entry.scrollTop;
      });
    };

    const runBurst = (duration: number) => {
      const start = performance.now();
      const tick = () => {
        if (!active) return;
        restore();
        if (performance.now() - start < duration) {
          requestAnimationFrame(tick);
        }
      };
      tick();
    };

    const runImmediateRestore = () => {
      IMMEDIATE_RESTORE_TIMINGS.forEach((timing, index) => {
        const timeoutId = window.setTimeout(() => {
          if (!active) return;
          restore();
          if (index === IMMEDIATE_RESTORE_TIMINGS.length - 1) {
            cleanup();
          }
        }, timing);
        timeouts.push(timeoutId);
      });
    };

    const cleanup = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('wheel', cancel, true);
      document.removeEventListener('touchstart', cancel, true);
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('keydown', cancel, true);
      timeouts.forEach((id) => clearTimeout(id));
      if (this.scrollRestoreCleanup === cleanup) {
        this.scrollRestoreCleanup = null;
      }
    };

    const triggerRestore = () => {
      if (!active || restored) return;
      restored = true;
      if (mode === 'immediate') {
        runImmediateRestore();
        return;
      }
      runBurst(BURST_DURATION);
      timeouts.push(window.setTimeout(cleanup, BURST_DURATION + 200));
    };

    const onVisibility = () => {
      if (document.hidden) {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        triggerRestore();
      }
    };

    const onFocus = () => {
      if (wasHidden) {
        triggerRestore();
      }
    };

    const cancel = () => {
      if (!restored) return;
      cleanup();
    };

    if (mode === 'focusAfterHidden') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }
    document.addEventListener('wheel', cancel, { passive: true, capture: true });
    document.addEventListener('touchstart', cancel, { passive: true, capture: true });
    document.addEventListener('pointerdown', cancel, { capture: true });
    document.addEventListener('keydown', cancel, { capture: true });

    this.scrollRestoreCleanup = cleanup;

    if (mode === 'immediate') {
      triggerRestore();
    }
  }

  private handleVimScroll(e: KeyboardEvent, type: ScrollType): boolean {
    const ae = document.activeElement;
    const isEditable =
      ae &&
      ((ae instanceof HTMLElement && ae.isContentEditable) ||
        /^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName));

    if (isEditable) return false;

    const container = this.getScrollContainer();

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

    document.addEventListener('click', (e) => this.handleDocumentClick(e), true);
    document.addEventListener('submit', (e) => this.handleDocumentSubmit(e), true);
    document.addEventListener('keydown', (e) => this.handleKeydown(e), true);
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.isKeyboardSend(e)) {
      this.preserveScrollOnSend();
    }

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

    if (this.matchesShortcut('modePro', e)) {
      e.preventDefault();
      this.selectMode('Pro');
      return;
    }

    if (this.matchesShortcut('temporaryChat', e)) {
      e.preventDefault();
      this.openTemporaryChat();
      return;
    }

    if (this.matchesShortcut('togglePinChat', e)) {
      e.preventDefault();
      this.togglePinChat();
      return;
    }

    if (this.matchesShortcut('branchChat', e)) {
      e.preventDefault();
      this.branchChat();
      return;
    }

    if (this.matchesShortcut('copyLastUserMessage', e)) {
      e.preventDefault();
      this.copyLastUserMessage();
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
    const shortcutDialog = document.querySelector<HTMLElement>(
      '[data-testid="keyboard-shortcuts-dialog"]'
    );
    if (shortcutDialog && this.isShortcutPanelCandidate(shortcutDialog)) {
      return shortcutDialog;
    }

    const nativeDialogs = Array.from(document.querySelectorAll<HTMLElement>('dialog'));
    for (let i = nativeDialogs.length - 1; i >= 0; i -= 1) {
      const dialog = nativeDialogs[i];
      if (this.isShortcutPanelCandidate(dialog)) {
        return dialog;
      }
    }

    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    for (let i = dialogs.length - 1; i >= 0; i -= 1) {
      const dialog = dialogs[i];
      if (this.isShortcutPanelCandidate(dialog)) {
        return dialog;
      }
    }

    const popovers = Array.from(
      document.querySelectorAll<HTMLElement>('.popover, [role="menu"], [data-radix-menu-content]')
    );
    for (let i = popovers.length - 1; i >= 0; i -= 1) {
      const popover = popovers[i];
      if (this.isShortcutPanelCandidate(popover)) {
        const dialog =
          (popover.closest('[data-testid="keyboard-shortcuts-dialog"]') as HTMLElement | null) ||
          (popover.closest('[role="dialog"]') as HTMLElement | null) ||
          (popover.closest('dialog') as HTMLElement | null);
        return dialog || popover;
      }
    }

    return null;
  }

  private isShortcutPanelCandidate(element: HTMLElement): boolean {
    const hasExplicitRoot =
      element.matches('[data-testid="keyboard-shortcuts-dialog"]') ||
      !!element.querySelector('[data-testid="keyboard-shortcuts-dialog"]');
    const hasHeading = Array.from(element.querySelectorAll('h1, h2, h3')).some(
      (heading) => this.normalizeMenuLabel(heading.textContent || '') === 'keyboard shortcuts'
    );
    const hasKeyHints = !!element.querySelector('kbd');
    const hasLegacyList = !!element.querySelector('dl');
    const hasModernList =
      !!element.querySelector('section ul li label') ||
      !!element.querySelector('input[name="keyboard-shortcut-capture"]');

    return hasKeyHints && (hasExplicitRoot || hasHeading) && (hasLegacyList || hasModernList);
  }

  private refreshShortcutPanel() {
    const panel = this.findShortcutPanel();
    if (panel) {
      this.decorateShortcutPanel(panel);
    }
  }

  private decorateShortcutPanel(panel: HTMLElement) {
    const root = this.resolveShortcutPanelRoot(panel);
    const scrollHost = this.findShortcutPanelScrollHost(root);

    scrollHost.style.maxHeight = '70vh';
    scrollHost.style.overflowY = 'auto';
    scrollHost.style.scrollbarWidth = 'thin';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scrollHost.style as any).webkitOverflowScrolling = 'touch';

    if (!scrollHost.dataset.customScrollBound) {
      const stop = (ev: Event) => ev.stopPropagation();
      scrollHost.addEventListener('wheel', stop, { passive: true });
      scrollHost.addEventListener('touchmove', stop, { passive: true });
      scrollHost.dataset.customScrollBound = 'true';
    }

    const modernPanelPatched = this.addCustomShortcutsToModernPanel(root);
    if (!modernPanelPatched) {
      this.addCustomShortcutsToMenu(root);
    }
    root.dataset.customShortcutsInjected = 'true';
  }

  private resolveShortcutPanelRoot(panel: HTMLElement): HTMLElement {
    if (panel.matches('[data-testid="keyboard-shortcuts-dialog"]')) return panel;

    return (
      (panel.querySelector('[data-testid="keyboard-shortcuts-dialog"]') as HTMLElement | null) ||
      (panel.closest('[data-testid="keyboard-shortcuts-dialog"]') as HTMLElement | null) ||
      (panel.closest('[role="dialog"]') as HTMLElement | null) ||
      (panel.closest('dialog') as HTMLElement | null) ||
      panel
    );
  }

  private findShortcutPanelScrollHost(root: HTMLElement): HTMLElement {
    return (
      root.querySelector<HTMLElement>('.overflow-y-auto') ||
      root.querySelector<HTMLElement>('dl') ||
      root
    );
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

  private createSettingsLink(): HTMLElement {
    const settingsLink = document.createElement('a');
    settingsLink.href = '#';
    settingsLink.textContent = getMessage('shortcut_panel_settings_link_text');
    settingsLink.style.color = 'inherit';
    settingsLink.style.textDecoration = 'underline';

    settingsLink.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      chrome.runtime.sendMessage({ action: 'openSettings' });
    });

    return settingsLink;
  }

  private createBindingsContainer(bindings: KeyBinding[]): HTMLElement {
    const container = document.createElement('div');
    container.className = 'flex shrink-0 items-center gap-1';

    bindings.forEach((binding, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'mx-1';
        sep.textContent = '/';
        container.appendChild(sep);
      }
      container.appendChild(this.createKbdGroup(this.bindingToTokens(binding)));
    });

    return container;
  }

  private getModernShortcutSections(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('section')).filter(
      (section) => !!section.querySelector('h3') && !!section.querySelector('ul')
    );
  }

  private getModernShortcutItemClass(index: number, total: number): string {
    const base = 'bg-token-bg-secondary squircle scroll-mt-12 scroll-mb-24';
    if (total <= 1) return `${base} rounded-[28px]`;
    if (index === 0) return `${base} rounded-t-[28px] rounded-b-[4px]`;
    if (index === total - 1) return `${base} rounded-t-[4px] rounded-b-[28px]`;
    return `${base} rounded-[4px]`;
  }

  private createModernShortcutRow(
    label: string,
    trailing: HTMLElement,
    index: number,
    total: number
  ): HTMLElement {
    const row = document.createElement('li');
    row.className = this.getModernShortcutItemClass(index, total);
    row.dataset.customShortcut = 'true';

    const content = document.createElement('div');
    content.className = 'flex min-h-[53px] items-center gap-2 py-2.5 ps-4 pe-3';

    const switchPlaceholder = document.createElement('span');
    switchPlaceholder.className =
      'relative box-content aspect-7/4 shrink-0 rounded-full p-[2px] h-4';
    switchPlaceholder.style.visibility = 'hidden';
    switchPlaceholder.setAttribute('aria-hidden', 'true');

    const labelEl = document.createElement('span');
    labelEl.className =
      'text-token-text-primary min-w-0 flex-1 truncate text-base leading-6 font-normal tracking-[0.01em]';
    labelEl.textContent = label;

    const trailingWrapper = document.createElement('div');
    trailingWrapper.className = 'flex shrink-0 items-center gap-1 text-token-text-secondary';
    trailingWrapper.appendChild(trailing);

    content.appendChild(switchPlaceholder);
    content.appendChild(labelEl);
    content.appendChild(trailingWrapper);
    row.appendChild(content);

    return row;
  }

  private addCustomShortcutsToModernPanel(root: HTMLElement): boolean {
    root.querySelectorAll('[data-custom-shortcut="true"]').forEach((el) => el.remove());

    const sections = this.getModernShortcutSections(root);
    const referenceSection = sections[sections.length - 1];
    if (!referenceSection) return false;

    const referenceHeading = referenceSection.querySelector('h3');
    const referenceHeadingSpan = referenceHeading?.querySelector('span');
    const referenceList = referenceSection.querySelector('ul');

    const section = document.createElement('section');
    section.className = referenceSection.className || 'flex flex-col gap-0.5';
    section.dataset.customShortcut = 'true';

    const headingId = 'chatgpt-unified-extension-shortcuts-heading';
    const heading = document.createElement('h3');
    heading.id = headingId;
    heading.className =
      referenceHeading?.className ||
      'text-token-text-secondary bg-token-bg-primary sticky top-0 z-10 scroll-mt-12 text-sm leading-6 font-semibold tracking-[0.01em]';
    heading.dataset.customShortcut = 'true';

    const headingSpan = document.createElement('span');
    headingSpan.className =
      referenceHeadingSpan?.className || 'stuck-border block border-b py-0.5 ps-6 pe-3';
    headingSpan.textContent = getMessage('shortcut_panel_extension_heading');
    heading.appendChild(headingSpan);

    const list = document.createElement('ul');
    list.className = referenceList?.className || 'flex list-none flex-col gap-0.5 px-3 py-0';
    list.setAttribute('aria-labelledby', headingId);

    const rows: { label: string; trailing: HTMLElement }[] = [
      {
        label: getMessage('shortcut_panel_settings_label'),
        trailing: this.createSettingsLink(),
      },
    ];

    SHORTCUT_DEFINITIONS.filter((def) => this.isEnabled(def.category)).forEach((def) => {
      const bindings = this.getDisplayBindings(def);
      if (!bindings.length) return;
      rows.push({
        label: getMessage(def.labelKey),
        trailing: this.createBindingsContainer(bindings),
      });
    });

    rows.forEach((row, index) => {
      list.appendChild(this.createModernShortcutRow(row.label, row.trailing, index, rows.length));
    });

    section.appendChild(heading);
    section.appendChild(list);
    referenceSection.after(section);

    return true;
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
