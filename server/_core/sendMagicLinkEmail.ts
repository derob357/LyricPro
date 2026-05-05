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

const FROM_ADDRESS = "LyricPro <noreply@playlyricpro.com>";
const SUBJECT = "Sign in to LyricPro Ai";

export async function sendMagicLinkEmail(params: {
  to: string;
  magicLinkUrl: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Set it in .env (and on the host) " +
        "before calling sendMagicLinkEmail."
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: SUBJECT,
    html: htmlBody(params.magicLinkUrl),
    text: textBody(params.magicLinkUrl),
  });

  if (error) {
    // Surface Resend's structured error so callers can decide whether to
    // propagate or swallow. Caller already sanitizes the response so this
    // detail does not leak to end users.
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

function htmlBody(url: string): string {
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
            </tr>
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

function textBody(url: string): string {
  return [
    "Sign in to LyricPro Ai",
    "",
    "Click the link below to sign in. This link will expire in one hour and can only be used once.",
    "",
    url,
    "",
    "If you didn't request this email, you can safely ignore it. No account changes will be made.",
  ].join("\n");
}
