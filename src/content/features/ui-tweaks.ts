import { FeatureToggles } from '@/shared/settings';

import { getInputField } from './utils';

export class UITweaksManager {
  private currentInput: HTMLElement | null = null;
  private abortController: AbortController | null = null;
  private observer: MutationObserver | null = null;
  private host: HTMLElement | null = null;
  private hostCheckId: number | null = null;
  private toggles: FeatureToggles;

  constructor(toggles: FeatureToggles) {
    this.toggles = toggles;
    if (this.toggles.wideScreen) {
      this.observe();
    }
  }

  public updateToggles(toggles: FeatureToggles) {
    this.toggles = toggles;
    if (this.toggles.wideScreen) {
      this.observe();
    } else {
      this.cleanupFocusBindings();
    }
  }

  public toggleFocus() {
    if (!this.toggles.wideScreen) return;
    const input = getInputField();
    if (!input) return;
    const isFocused =
      document.activeElement === input || input.classList.contains('ProseMirror-focused');
    if (isFocused) {
      input.blur();
    } else {
      input.focus();
    }
  }

  private bindInputFocusEffect(input: HTMLElement) {
    if (this.currentInput === input) return;
    if (this.abortController) this.abortController.abort();

    const container = input.closest('#thread-bottom-container');
    if (!container) return;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const onFocus = () => container.classList.add('focused');
    const onBlur = () => container.classList.remove('focused');

    input.addEventListener('focus', onFocus, { signal });
    input.addEventListener('blur', onBlur, { signal });

    if (document.activeElement === input) {
      container.classList.add('focused');
    } else {
      container.classList.remove('focused');
    }

    this.currentInput = input;
  }

  private observe() {
    if (this.observer) return;

    const initialInput = getInputField();
    const host =
      (document.querySelector('#thread-bottom-container') as HTMLElement | null) ||
      (initialInput?.closest('.composer-parent') as HTMLElement | null) ||
      (initialInput?.closest('div[role="presentation"].composer-parent') as HTMLElement | null) ||
      (document.querySelector('main') as HTMLElement | null) ||
      document.body ||
      (document.documentElement as HTMLElement | null);
    if (!host) return;

    this.host = host;
    this.observer = new MutationObserver(() => {
      const input = getInputField();
      if (input) {
        this.bindInputFocusEffect(input);
      }
    });

    this.observer.observe(host, { childList: true, subtree: true });
    this.startHostMonitor();

    const input = initialInput ?? getInputField();
    if (input) this.bindInputFocusEffect(input);
  }

  private cleanupFocusBindings() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentInput) {
      const container = this.currentInput.closest('#thread-bottom-container');
      if (container) {
        container.classList.remove('focused');
      }
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.host = null;
    this.stopHostMonitor();
    this.currentInput = null;
  }

  private startHostMonitor() {
    if (this.hostCheckId) return;

    const tick = () => {
      // observer/hostが消えたら再観測を試みる
      if (!this.observer || !this.host || !this.host.isConnected) {
        this.reconnectObserver();
        return;
      }
      this.hostCheckId = requestAnimationFrame(tick);
    };

    this.hostCheckId = requestAnimationFrame(tick);
  }

  private stopHostMonitor() {
    if (this.hostCheckId) {
      cancelAnimationFrame(this.hostCheckId);
      this.hostCheckId = null;
    }
  }

  private reconnectObserver() {
    this.stopHostMonitor();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.host = null;
    this.observe();
  }
}
