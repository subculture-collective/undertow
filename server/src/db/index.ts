import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as authSchema from './auth-schema.js';
import * as appSchema from './schema.js';

/**
 * Bounded so a burst of slow requests fails fast instead of queueing forever:
 * waiting for a connection, a single statement and an idle open transaction
 * all have limits. Request handlers never hold a connection while streaming a
 * body or calling Stripe.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
  idleTimeoutMillis: 30_000,
  statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: 15_000,
});
// An idle client can lose its connection (database restart, network). Without a listener that error crashes the process.
pool.on('error', (error) => console.error('idle database connection failed', error));
export const schema = { ...authSchema, ...appSchema };
export const db = drizzle({ client: pool, schema, casing: 'snake_case' });
export type DB = typeof db;
