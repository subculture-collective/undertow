import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '../env.js';

// A dedicated connection without the API's statement limits, so a long migration isn't cut off.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
await migrate(drizzle({ client: pool, casing: 'snake_case' }), { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
console.log('Migrations applied.');
await pool.end();
