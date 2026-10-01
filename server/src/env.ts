import { z } from 'zod';

/** Environment, validated once at startup so a missing secret fails loudly instead of at first use. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  DATABASE_URL: z.string().url(),
  PUBLIC_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters; use `openssl rand -base64 32`'),
  TRUSTED_ORIGINS: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  SMTP_URL: z.string().default(''),
  /** Brevo transactional email API key. Takes precedence over SMTP_URL. */
  BREVO_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('Undertow <no-reply@localhost>'),
  STRIPE_API_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_CREATOR_PRICE_ID: z.string().default(''),
  STRIPE_PORTAL_CONFIGURATION_ID: z.string().default(''),
  /** Explicit opt-in required before accepting live payments. */
  STRIPE_LIVE_MODE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  STATIC_DIR: z.string().default(''),
  /** Where render inputs and outputs are kept. */
  RENDER_DIR: z.string().default('./data/renders'),
  /** Days a finished render stays downloadable. */
  RENDER_OUTPUT_DAYS: z.coerce.number().int().min(1).default(7),
  /** Shared secret the render worker uses to claim jobs. Empty disables the worker endpoints. */
  WORKER_SECRET: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const trustedOrigins = [env.PUBLIC_URL, ...env.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)];
export const providers = {
  google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
};
