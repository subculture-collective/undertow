/**
 * Application tables. Better Auth's tables (user, session, account,
 * verification, apikey) are generated into auth-schema.ts.
 */
import { sql } from 'drizzle-orm';
import { bigserial, customType, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** One row per account: plan and the defaults new projects start from. */
export const profile = pgTable('profile', {
  userId: text().primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  plan: text().notNull().default('free'),
  defaults: jsonb().notNull().default(sql`'{}'::jsonb`),
  updatedAt: now(),
});

/**
 * A saved layout. Media stays on the user's devices; `media` lists the files
 * the layout refers to (id, kind, name, size) so another device can ask for them.
 */
export const project = pgTable('project', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  data: jsonb().notNull(),
  media: jsonb().notNull().default(sql`'[]'::jsonb`),
  /** Incremented on every write; clients send it back to detect conflicting edits. */
  revision: integer().notNull().default(1),
  thumbnail: bytea(),
  thumbnailType: text(),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index('project_user_updated_idx').on(t.userId, t.updatedAt)]);

/** Templates published by users. Built-in templates come from the editor's code (see data/templates.json). */
export const template = pgTable('template', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  description: text().notNull().default(''),
  data: jsonb().notNull(),
  visibility: text().notNull().default('private'),
  thumbnail: bytea(),
  thumbnailType: text(),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [index('template_visibility_idx').on(t.visibility, t.updatedAt), index('template_user_idx').on(t.userId)]);

/** Colour palettes saved by users. Built-in palettes live in code. */
export const palette = pgTable('palette', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  colors: jsonb().notNull(),
  createdAt: now(),
}, (t) => [index('palette_user_idx').on(t.userId)]);

/** One row per authenticated API request, for usage reporting and future billing. */
export const usageEvent = pgTable('usage_event', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  apiKeyId: text(),
  method: text().notNull(),
  route: text().notNull(),
  status: integer().notNull(),
  /** Billable units: 1 per request; render jobs will record seconds of output. */
  units: integer().notNull().default(1),
  createdAt: now(),
}, (t) => [index('usage_user_created_idx').on(t.userId, t.createdAt)]);
