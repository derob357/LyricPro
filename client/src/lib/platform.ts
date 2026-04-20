import { Capacitor } from "@capacitor/core";

// Single source of truth for "am I running inside a native shell?"
// Imported everywhere in the client that needs to conditionally hide
// paid UI or change behavior for iOS / Android builds.
//
// App Store compliance note: all paid purchase UI must be gated OFF
// when IS_NATIVE is true. Apple §3.1.1 requires digital goods to go
// through IAP; we bypass that restriction by selling only on the web.
// See docs/mobile-app-plan.md for the full Path 1 policy.

export const IS_NATIVE: boolean = Capacitor.isNativePlatform();
export const IS_IOS: boolean = Capacitor.getPlatform() === "ios";
export const IS_ANDROID: boolean = Capacitor.getPlatform() === "android";
export const IS_WEB: boolean = !IS_NATIVE;

// True when paid purchase UI is allowed to render. False on native.
export const CAN_PURCHASE: boolean = IS_WEB;
