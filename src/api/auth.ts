import { createAuthClient } from 'better-auth/react';

/** Sign-in, sign-up, OAuth and account linking, served by the API under /v1/auth. */
export const authClient = createAuthClient({ baseURL: `${window.location.origin}/v1/auth` });

/** Google scope that lets Undertow read your YouTube channel name, requested only when linking YouTube. */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
