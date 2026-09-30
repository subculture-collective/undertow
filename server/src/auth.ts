import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { openAPI } from 'better-auth/plugins';
import { db, schema } from './db/index.js';
import { profile } from './db/schema.js';
import { env, isProd, providers, trustedOrigins } from './env.js';
import { sendMail } from './lib/mail.js';

export const AUTH_BASE_PATH = '/v1/auth';

/** Scope that lets us read the signed-in user's YouTube channel, requested only when they link YouTube. */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

export const auth = betterAuth({
  appName: 'Undertow',
  baseURL: env.PUBLIC_URL,
  basePath: AUTH_BASE_PATH,
  secret: env.AUTH_SECRET,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(user.email, 'Reset your Undertow password', `Reset your password here:\n${url}\n\nIf you didn't ask for this, ignore this email.`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(user.email, 'Confirm your Undertow email', `Confirm your email address:\n${url}`);
    },
  },

  socialProviders: {
    ...(providers.google ? {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Offline access gives a refresh token, so YouTube can be read after the first hour.
        accessType: 'offline',
        prompt: 'select_account consent',
      },
    } : {}),
    ...(providers.discord ? {
      discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET },
    } : {}),
  },

  // People can delete their account; projects, templates, palettes, keys and usage go with it (foreign keys cascade).
  user: { deleteUser: { enabled: true } },

  account: {
    // Linked accounts ("attach Discord") often use a different email than the sign-in one.
    // That only applies to deliberate linking while signed in; signing in never merges accounts by a new email.
    accountLinking: { enabled: true, trustedProviders: ['google', 'discord'], allowDifferentEmails: true },
    encryptOAuthTokens: true,
  },

  databaseHooks: {
    user: {
      create: {
        after: async (u) => { await db.insert(profile).values({ userId: u.id }).onConflictDoNothing(); },
      },
    },
  },

  advanced: {
    cookiePrefix: 'ut',
    useSecureCookies: isProd,
    // Behind Cloudflare and Caddy, the socket address is the proxy's; rate limits need the visitor's.
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
  },

  plugins: [
    // Keys are verified and rate limited by our own middleware (per plan), not the plugin's defaults.
    apiKey({ defaultPrefix: 'ut_', apiKeyHeaders: ['x-api-key'], rateLimit: { enabled: false }, enableMetadata: true }),
    openAPI({ disableDefaultReference: true }),
  ],
});

export type Session = typeof auth.$Infer.Session;
