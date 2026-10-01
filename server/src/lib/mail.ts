import nodemailer from 'nodemailer';
import { env } from '../env.js';

const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

/** "Undertow <noreply@example.com>" or a bare address, split for APIs that want the parts. */
function parseFrom(from: string) {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2] } : { email: from.trim() };
}

/** Brevo's transactional email API. Needs only an API key; the sender's domain must be authenticated in Brevo. */
async function sendWithBrevo(to: string, subject: string, text: string) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(env.MAIL_FROM), to: [{ email: to }], subject, textContent: text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo rejected the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

/**
 * Sends an email through Brevo's API when BREVO_API_KEY is set, otherwise SMTP_URL. With neither
 * (development), it prints the email to the log.
 */
export async function sendMail(to: string, subject: string, text: string) {
  if (env.BREVO_API_KEY) return sendWithBrevo(to, subject, text);
  if (transport) {
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
    return;
  }
  console.log(`\n[mail] to ${to}: ${subject}\n${text}\n`);
}
