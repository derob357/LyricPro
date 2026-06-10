import { describe, it, expect } from "vitest";
import { buildConsentStamp, CONSENT_WORDING_VERSION } from "./_core/consent";

describe("buildConsentStamp", () => {
  it("opted in: stamps version, source, ip, and a consentedAt date", () => {
    const s = buildConsentStamp(true, "home-play-card", "1.2.3.4");
    expect(s.marketingOptIn).toBe(true);
    expect(s.consentWordingVersion).toBe(CONSENT_WORDING_VERSION);
    expect(s.consentSource).toBe("home-play-card");
    expect(s.consentIp).toBe("1.2.3.4");
    expect(s.consentedAt).toBeInstanceOf(Date);
  });

  it("not opted in: opt-in false and ALL audit fields null (no data hoarding)", () => {
    const s = buildConsentStamp(false, "home-play-card", "1.2.3.4");
    expect(s).toEqual({
      marketingOptIn: false,
      consentedAt: null,
      consentWordingVersion: null,
      consentSource: null,
      consentIp: null,
    });
  });

  it("clamps source length and tolerates missing ip", () => {
    const s = buildConsentStamp(true, "x".repeat(100), undefined);
    expect(s.consentSource!.length).toBeLessThanOrEqual(64);
    expect(s.consentIp).toBeNull();
  });
});
