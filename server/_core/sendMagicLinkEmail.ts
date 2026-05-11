// Sends sign-in magic-link emails via Resend, bypassing Supabase's built-in
// email sender (which has a tight free-tier rate limit). Used by the
// auth.sendMagicLink tRPC mutation.
//
// Requires:
//   - RESEND_API_KEY env var (server-side; never expose to the client)
//   - A verified sending domain in the Resend dashboard whose DNS the
//     FROM_ADDRESS below resolves to. Without verification, Resend will
//     reject sends to addresses other than the one tied to the account.
//
// Template is intentionally plain HTML — no MJML / framework — so it
// renders cleanly across mail clients without bundling a templating dep.

import { Resend } from "resend";

// Redact email addresses before writing to logs to avoid accumulating PII in
// production log storage. Preserves the domain (safe — no PII) and shows
// first/last character of the local-part for minimal debuggability.
function redactEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const visible =
    user.length <= 2 ? "*" : `${user[0]}***${user[user.length - 1]}`;
  return `${visible}@${domain}`;
}

// Default falls back to the current verified sender. Override via env once
// the dedicated auth subdomain (e.g. login@auth.playlyricpro.com) is verified
// in the Resend dashboard — keeps marketing/transactional reputations
// isolated and lets us drop the noreply@ pattern Resend recommends against.
const FROM_ADDRESS =
  process.env.MAGIC_LINK_FROM_ADDRESS ?? "LyricPro <noreply@playlyricpro.com>";

export async function sendMagicLinkEmail(params: {
  to: string;
  magicLinkUrl: string;
  // Optional 6-digit one-time code (Supabase generateLink returns it as
  // properties.email_otp). Rendered in the email next to the link as a
  // fallback for corporate URL scanners (Outlook Safe Links, Defender,
  // Mimecast, Proofpoint) that pre-fetch and consume the link's token.
  otp?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Set it in .env (and on the host) " +
        "before calling sendMagicLinkEmail."
    );
  }

  // Subject includes the OTP when present so Gmail's threading doesn't bury
  // each new request under the prior expired one. Each request gets its
  // own conversation.
  const subject = params.otp
    ? `Sign in to LyricPro Ai — code ${params.otp}`
    : "Sign in to LyricPro Ai";

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject,
    html: htmlBody(params.magicLinkUrl, params.otp),
    text: textBody(params.magicLinkUrl, params.otp),
  });

  // Successful sends ALSO get logged so a "never got it" support ticket can
  // be looked up by recipient email or Resend ID. Without this line we had
  // no record of accepted-by-Resend sends — only failures — which made
  // intermittent ISP-side delivery problems impossible to diagnose.
  if (!error && data?.id) {
    const domain = params.to.split("@")[1] ?? "unknown";
    console.log(
      "[sendMagicLinkEmail:resend:sent]",
      JSON.stringify({ id: data.id, to: redactEmail(params.to), domain })
    );
  }

  if (error) {
    // Log the structured fields at source — Vercel's log table truncates
    // long messages, and stringifying through err.message hid the real
    // reason during the noreply@lyricpro.ai outage. JSON-encoded so each
    // field shows up in the table even after truncation.
    console.error(
      "[sendMagicLinkEmail:resend]",
      JSON.stringify({
        name: error.name,
        message: error.message,
        statusCode: (error as { statusCode?: number }).statusCode,
      })
    );
    const e: Error & { resendError?: unknown } = new Error(
      `Resend send failed: ${error.name}: ${error.message}`
    );
    e.resendError = error;
    throw e;
  }
}

function htmlBody(url: string, otp?: string): string {
  // The OTP block, when present, sits between the link button and the raw
  // URL fallback. It's the resilience path: corporate URL scanners that
  // pre-fetch the link can't pre-consume a code the user has to type.
  const otpBlock = otp
    ? `
            <tr>
              <td style="padding-bottom:24px;">
                <div style="background:#1c1c28;border:1px solid #2a2a3a;border-radius:10px;padding:18px;text-align:center;">
                  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9999b0;margin-bottom:8px;">Or enter this code</div>
                  <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:0.4em;color:#a855f7;">${otp}</div>
                  <div style="font-size:11px;color:#6b6b80;margin-top:10px;line-height:1.4;">Useful if the link doesn't open in your usual browser, or if your email provider expires it before you click.</div>
                </div>
              </td>
            </tr>`
    : "";

  // Inline styles only — most mail clients strip <style> blocks. Keep the
  // markup short and let mail clients fall back to text/plain when they
  // can't render HTML at all.
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8e8f0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0a0f;padding:40px 20px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background:#15151f;border:1px solid #2a2a3a;border-radius:16px;padding:32px;">
            <tr>
              <td style="text-align:center;padding-bottom:24px;">
                <div style="font-size:24px;font-weight:700;background:linear-gradient(90deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#a855f7;">LyricPro Ai</div>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:16px;">
                <h1 style="margin:0;font-size:20px;font-weight:600;color:#e8e8f0;">Sign in to LyricPro Ai</h1>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;color:#9999b0;font-size:14px;line-height:1.5;">
                Click the button below to sign in. This link will expire in one hour and can only be used once.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${url}" style="display:inline-block;background:#a855f7;color:#ffffff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">Sign in to LyricPro Ai</a>
              </td>
            </tr>${otpBlock}
            <tr>
              <td style="padding-bottom:8px;color:#6b6b80;font-size:12px;">
                If the button doesn't work, paste this URL into your browser:
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11px;color:#9999b0;word-break:break-all;">
                ${url}
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #2a2a3a;padding-top:16px;color:#6b6b80;font-size:12px;line-height:1.5;">
                If you didn't request this email, you can safely ignore it. No account changes will be made.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function textBody(url: string, otp?: string): string {
  const lines = [
    "Sign in to LyricPro Ai",
    "",
    "Click the link below to sign in. This link will expire in one hour and can only be used once.",
    "",
    url,
  ];
  if (otp) {
    lines.push("", `Or enter this code on the sign-in page: ${otp}`);
  }
  lines.push(
    "",
    "If you didn't request this email, you can safely ignore it. No account changes will be made.",
  );
  return lines.join("\n");
}
