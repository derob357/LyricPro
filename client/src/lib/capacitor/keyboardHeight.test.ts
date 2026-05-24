import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const willShowListeners: Array<(info: { keyboardHeight: number }) => void> = [];
const didHideListeners: Array<() => void> = [];

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn((event: string, cb: (info: { keyboardHeight: number }) => void) => {
      if (event === "keyboardWillShow") willShowListeners.push(cb);
      if (event === "keyboardDidHide") didHideListeners.push(cb as () => void);
      return Promise.resolve({ remove: vi.fn() });
    }),
    removeAllListeners: vi.fn(() => Promise.resolve()),
  },
}));

import { useKeyboardHeight } from "./useKeyboardHeight";

beforeEach(() => {
  willShowListeners.length = 0;
  didHideListeners.length = 0;
  document.documentElement.style.removeProperty("--kb-height");
});

afterEach(() => {
  document.documentElement.style.removeProperty("--kb-height");
});

describe("useKeyboardHeight", () => {
  it("sets --kb-height on keyboardWillShow", () => {
    renderHook(() => useKeyboardHeight());
    expect(willShowListeners).toHaveLength(1);
    willShowListeners[0]({ keyboardHeight: 320 });
    expect(document.documentElement.style.getPropertyValue("--kb-height")).toBe("320px");
  });

  it("resets --kb-height to 0 on keyboardDidHide", () => {
    renderHook(() => useKeyboardHeight());
    willShowListeners[0]({ keyboardHeight: 320 });
    didHideListeners[0]();
    expect(document.documentElement.style.getPropertyValue("--kb-height")).toBe("0px");
  });
});
