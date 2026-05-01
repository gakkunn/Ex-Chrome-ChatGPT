import { getMessage } from '@/shared/i18n';

const activeNotifications = new Set<string>();

export function waitFor(
  selector: string | (() => Element | null),
  options: { timeout?: number; interval?: number; retries?: number } = {}
): Promise<Element> {
  const { timeout = 800, interval = 100 } = options;
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    const check = () => {
      const element =
        typeof selector === 'function' ? selector() : document.querySelector(selector);
      if (element) {
        resolve(element);
      } else if (performance.now() - startTime > timeout) {
        reject(new Error(getMessage('error_timeout_generic')));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

export function getInputField(): HTMLElement | null {
  const selectors = [
    '#thread-bottom-container div#prompt-textarea[contenteditable="true"]',
    '#thread-bottom-container div.ProseMirror[contenteditable="true"]',
    '#thread-bottom-container [role="textbox"][contenteditable="true"]',
    'div#prompt-textarea[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    'textarea[name="prompt-textarea"]',
    '[contenteditable="true"]',
  ];
  const seen = new Set<Element>();
  const candidates = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return true;
    });

  return (
    candidates.find((element) => {
      if (!element.isConnected) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return element.getClientRects().length > 0;
    }) ||
    candidates.find((element) => element.isConnected) ||
    null
  );
}

export function showNotification(message: string, type: 'success' | 'error' = 'error') {
  // Duplicate check: ignore if the same message is already displayed
  if (activeNotifications.has(message)) {
    return;
  }

  // Record as an active notification
  activeNotifications.add(message);

  const toast = document.createElement('div');
  toast.className = 'custom-shortcut-toast';
  toast.textContent = message;
  toast.style.background = type === 'success' ? '#10a37f' : '#ef4444';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
      // Remove from tracking Set once the notification is completely removed
      activeNotifications.delete(message);
    }, 300);
  }, 1500);
}

export function humanClick(element: Element, options: { scroll?: boolean } = {}) {
  if (!element) throw new Error('No element to click');
  if (
    (element as HTMLButtonElement | HTMLInputElement).disabled ||
    element.getAttribute('aria-disabled') === 'true'
  )
    return;

  const { scroll = true } = options;
  if (scroll) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  }
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const mouseInit = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  };
  const pointerInit = {
    ...mouseInit,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    buttons: 1,
  };

  element.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
  element.dispatchEvent(new MouseEvent('mousedown', mouseInit));
  element.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', mouseInit));
  (element as HTMLElement).click();
}
