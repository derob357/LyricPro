/** Marketing-consent audit stamping.
 *  Version id must match the wording rendered by the client checkboxes
 *  (PlayNowCard, SignIn, ProfileCompletion). Bump when the wording changes:
 *  "Yes, I'd like to receive tips, game updates, and promotions from
 *   LyricPro by email. Unsubscribe anytime."
 */
export const CONSENT_WORDING_VERSION = "lp-optin-v1";

export interface ConsentStamp {
  marketingOptIn: boolean;
  consentedAt: Date | null;
  consentWordingVersion: string | null;
  consentSource: string | null;
  consentIp: string | null;
}

export function buildConsentStamp(
  optIn: boolean,
  source: string | undefined,
  ip: string | undefined | null,
): ConsentStamp {
  if (!optIn) {
    return {
      marketingOptIn: false,
      consentedAt: null,
      consentWordingVersion: null,
      consentSource: null,
      consentIp: null,
    };
  }
  return {
    marketingOptIn: true,
    consentedAt: new Date(),
    consentWordingVersion: CONSENT_WORDING_VERSION,
    consentSource: (source ?? "unknown").slice(0, 64),
    consentIp: ip ? ip.slice(0, 45) : null,
  };
}
