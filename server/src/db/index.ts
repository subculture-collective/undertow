import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as authSchema from './auth-schema.js';
import * as appSchema from './schema.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const schema = { ...authSchema, ...appSchema };
export const db = drizzle({ client: pool, schema, casing: 'snake_case' });
export type DB = typeof db;
