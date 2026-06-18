import nodemailer from "nodemailer";

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

function smtpPort(): number {
  const raw = process.env.SMTP_PORT?.trim();
  if (!raw) return 587;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 587;
}

export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
}): Promise<{ delivered: boolean }> {
  const from =
    process.env.SMTP_FROM?.trim() || "Condo Board <noreply@localhost>";
  const subject = "Reset your Condo Board password";
  const text = [
    "You requested a password reset for Condo Board AI Assistant.",
    "",
    "Open this link to choose a new password (expires in 1 hour):",
    input.resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
  const html = [
    "<p>You requested a password reset for <strong>Condo Board AI Assistant</strong>.</p>",
    `<p><a href="${input.resetUrl}">Choose a new password</a> (link expires in 1 hour).</p>`,
    "<p>If you did not request this, you can ignore this email.</p>",
  ].join("");

  if (!isMailConfigured()) {
    console.info(
      `[auth:password-reset] SMTP not configured. Reset link for ${input.to}: ${input.resetUrl}`,
    );
    return { delivered: false };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port: smtpPort(),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER?.trim() && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER.trim(),
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });

  await transporter.sendMail({
    from,
    to: input.to,
    subject,
    text,
    html,
  });

  return { delivered: true };
}
