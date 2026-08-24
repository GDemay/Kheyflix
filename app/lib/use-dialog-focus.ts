"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const visibleFocusable = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );

export function useDialogFocus<T extends HTMLElement>(
  onClose: () => void,
  options: {
    active?: boolean;
    initialFocus?: string;
    restoreFocus?: boolean;
    returnFocus?: string;
  } = {},
) {
  const container = useRef<T>(null);
  const close = useRef(onClose);
  const active = options.active ?? true;
  const initialFocus = options.initialFocus;
  const restoreFocus = options.restoreFocus ?? true;
  const returnFocus = options.returnFocus;

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = container.current;
    if (!active || !dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      const requested = initialFocus
        ? dialog.querySelector<HTMLElement>(initialFocus)
        : null;
      (requested || visibleFocusable(dialog)[0] || dialog).focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = visibleFocusable(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (restoreFocus)
        requestAnimationFrame(() => {
          const target =
            (returnFocus
              ? document.querySelector<HTMLElement>(returnFocus)
              : null) || previousFocus;
          if (target?.isConnected) target.focus();
        });
    };
  }, [active, initialFocus, restoreFocus, returnFocus]);

  return container;
}
