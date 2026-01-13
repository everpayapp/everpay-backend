import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "EverPay <no-reply@everpayapp.co.uk>";

export async function sendResetEmail({ to, username, link }) {
  // If not configured, do nothing (keeps prod safe until you add keys)
  if (!RESEND_API_KEY) {
    console.log("[email] RESEND_API_KEY not set - skipping email send");
    return;
  }

  const resend = new Resend(RESEND_API_KEY);

  const subject = "Reset your EverPay password";
  const text = `Hi ${username},

We received a request to reset your EverPay password.

Reset link (valid for 1 hour):
${link}

If you didn’t request this, you can ignore this email.`;

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    text,
  });
}
