// Listens to @capacitor/keyboard events and reflects the on-screen
// keyboard height into a CSS variable (--kb-height) on the document root.
//
// Why a CSS var rather than a context: layout-critical, hot-path
// computation. A CSS-var update doesn't re-render any React tree, and
// any element using calc(env(...) + var(--kb-height)) updates atomically
// without prop drilling.
//
// Mount once at the App root. Safe to call on web — Capacitor Keyboard
// is a no-op outside the native shell.
import { useEffect } from "react";
import { Keyboard } from "@capacitor/keyboard";

export function useKeyboardHeight(): void {
  useEffect(() => {
    const willShowSub = Keyboard.addListener("keyboardWillShow", (info) => {
      document.documentElement.style.setProperty("--kb-height", `${info.keyboardHeight}px`);
    });
    const didHideSub = Keyboard.addListener("keyboardDidHide", () => {
      document.documentElement.style.setProperty("--kb-height", "0px");
    });

    return () => {
      void willShowSub.then((sub) => sub.remove());
      void didHideSub.then((sub) => sub.remove());
    };
  }, []);
}
