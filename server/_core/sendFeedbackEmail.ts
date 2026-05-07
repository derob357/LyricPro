// Sends Send-Feedback widget submissions to the team inbox via Resend.
// Mirrors sendMagicLinkEmail / sendPasswordResetEmail — same FROM domain
// (verified playlyricpro.com), same Resend client, same structured error
// logging. The submitter's email goes into reply_to so a reply from the
// team inbox lands back in the user's inbox.

import { Resend } from "resend";

const FROM_ADDRESS = "LyricPro Feedback <noreply@playlyricpro.com>";
const TO_ADDRESS = "answers@fisystems.net";

export type FeedbackType = "feedback" | "support" | "bug";

export async function sendFeedbackEmail(params: {
  type: FeedbackType;
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Set it in .env (and on the host) " +
        "before calling sendFeedbackEmail."
    );
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: TO_ADDRESS,
    replyTo: params.email,
    subject: subjectFor(params),
    html: htmlBody(params),
    text: textBody(params),
  });

  if (!error && data?.id) {
    console.log(
      "[sendFeedbackEmail:resend:sent]",
      JSON.stringify({ id: data.id, type: params.type, fromUser: params.email })
    );
  }

  if (error) {
    console.error(
      "[sendFeedbackEmail:resend]",
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

function subjectFor(p: { type: FeedbackType; name: string }): string {
  const label =
    p.type === "bug" ? "Bug Report"
    : p.type === "support" ? "Support Request"
    : "Feedback";
  return `[LyricPro ${label}] from ${p.name}`;
}

function htmlBody(p: {
  type: FeedbackType;
  name: string;
  email: string;
  message: string;
}): string {
  const escaped = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8e8f0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0a0f;padding:40px 20px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#15151f;border:1px solid #2a2a3a;border-radius:16px;padding:32px;">
            <tr>
              <td style="padding-bottom:16px;">
                <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#9999b0;">LyricPro Ai · ${escaped(p.type)}</div>
                <h1 style="margin:8px 0 0 0;font-size:18px;font-weight:600;color:#e8e8f0;">${escaped(subjectFor(p))}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:8px;color:#9999b0;font-size:13px;">From</td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;color:#e8e8f0;font-size:14px;">
                ${escaped(p.name)} &lt;${escaped(p.email)}&gt;
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:8px;color:#9999b0;font-size:13px;">Message</td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;color:#e8e8f0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escaped(p.message)}</td>
            </tr>
            <tr>
              <td style="border-top:1px solid #2a2a3a;padding-top:16px;color:#6b6b80;font-size:12px;line-height:1.5;">
                Reply to this email to respond directly to ${escaped(p.name)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function textBody(p: {
  type: FeedbackType;
  name: string;
  email: string;
  message: string;
}): string {
  return [
    subjectFor(p),
    "",
    `From: ${p.name} <${p.email}>`,
    `Type: ${p.type}`,
    "",
    "Message:",
    p.message,
    "",
    "—",
    `Reply to this email to respond directly to ${p.name}.`,
  ].join("\n");
}
