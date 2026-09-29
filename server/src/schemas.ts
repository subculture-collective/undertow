/**
 * Public API schemas. They validate requests, shape responses and generate the
 * OpenAPI document, so the published contract can't drift from the code.
 */
import { z } from '@hono/zod-openapi';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'a #rrggbb colour');

export const SocialPlatform = z.enum([
  'instagram', 'tiktok', 'youtube', 'spotify', 'applemusic', 'soundcloud', 'bandcamp', 'x', 'threads', 'bluesky',
  'facebook', 'twitch', 'discord', 'patreon', 'linktree', 'deezer', 'tidal', 'web',
]).openapi('SocialPlatform');

export const SocialItem = z.object({
  platform: SocialPlatform,
  handle: z.string().max(120),
}).openapi('SocialItem');

export const Palette = z.object({
  primary: hex, secondary: hex, accent: hex, background: hex, text: hex,
}).openapi('PaletteColors', { description: 'Five colours applied to new projects: meters and spectra use primary/secondary, highlights use accent.' });

export const Defaults = z.object({
  artistName: z.string().max(120).default(''),
  website: z.string().max(300).default(''),
  socials: z.array(SocialItem).max(12).default([]),
  palette: Palette.nullable().default(null),
  font: z.string().max(120).default(''),
  /** Apply these defaults automatically when starting a project from a template. */
  applyToNewProjects: z.boolean().default(true),
}).openapi('Defaults');

export const Connection = z.object({
  provider: z.string().openapi({ example: 'google' }),
  accountId: z.string(),
  linkedAt: z.string().datetime(),
}).openapi('Connection');

export const Me = z.object({
  id: z.string(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  name: z.string(),
  image: z.string().nullable(),
  plan: z.string().openapi({ example: 'free' }),
  defaults: Defaults,
  connections: z.array(Connection),
}).openapi('Me');

export const UpdateMe = z.object({ name: z.string().min(1).max(120) }).partial().openapi('UpdateMe');

/**
 * A project layout. The editor's format is versioned; the API checks the
 * outer shape and stores layers as-is so the editor can add layer types
 * without an API release.
 */
export const ProjectData = z.object({
  version: z.literal(1),
  name: z.string().max(200),
  audioAssetId: z.string().nullable(),
  layers: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).max(200),
}).passthrough().openapi('ProjectData');

export const MediaRef = z.object({
  id: z.string(),
  kind: z.enum(['image', 'audio', 'lyrics', 'video', 'font']),
  name: z.string().max(300),
  size: z.number().int().nonnegative().optional(),
}).openapi('MediaRef', { description: 'A file the layout uses. Files stay on the device; this lets another device ask for them by name.' });

export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int(),
  hasThumbnail: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ProjectSummary');

export const Project = ProjectSummary.extend({
  data: ProjectData,
  media: z.array(MediaRef),
}).openapi('Project');

export const CreateProject = z.object({
  name: z.string().min(1).max(200),
  data: ProjectData,
  media: z.array(MediaRef).max(500).default([]),
}).openapi('CreateProject');

export const UpdateProject = z.object({
  name: z.string().min(1).max(200).optional(),
  data: ProjectData.optional(),
  media: z.array(MediaRef).max(500).optional(),
  /** The revision this edit is based on. A mismatch returns 409 instead of overwriting newer work. */
  baseRevision: z.number().int().optional(),
}).openapi('UpdateProject');

export const Page = <T extends z.ZodTypeAny>(item: T, name: string) => z.object({
  items: z.array(item),
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: z.string().nullable(),
}).openapi(name);

export const TemplateSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  builtIn: z.boolean(),
  visibility: z.enum(['private', 'public']),
  author: z.string().nullable().openapi({ description: 'Display name of the publisher; null for built-in templates.' }),
  hasThumbnail: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
}).openapi('TemplateSummary');

export const Template = TemplateSummary.extend({ data: ProjectData }).openapi('Template');

export const CreateTemplate = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  data: ProjectData,
  visibility: z.enum(['private', 'public']).default('private'),
}).openapi('CreateTemplate');

export const PaletteRecord = z.object({
  id: z.string(),
  name: z.string(),
  colors: Palette,
  builtIn: z.boolean(),
}).openapi('Palette');

export const CreatePalette = z.object({ name: z.string().min(1).max(80), colors: Palette }).openapi('CreatePalette');

export const ApiKey = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** The first characters of the key, to tell keys apart. The full key is shown only once, at creation. */
  start: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
}).openapi('ApiKey');

export const CreatedApiKey = ApiKey.extend({
  key: z.string().openapi({ description: 'The secret key. Store it now; it cannot be retrieved again.' }),
}).openapi('CreatedApiKey');

export const CreateApiKey = z.object({
  name: z.string().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional(),
}).openapi('CreateApiKey');

export const UsageDay = z.object({
  date: z.string().openapi({ example: '2026-09-29' }),
  requests: z.number().int(),
  units: z.number().int(),
}).openapi('UsageDay');

export const Usage = z.object({
  plan: z.string(),
  limits: z.object({
    requestsPerMinute: z.number().int(), maxProjects: z.number().int(), maxTemplates: z.number().int(),
    maxApiKeys: z.number().int(), renderMinutesPerMonth: z.number().int(),
  }),
  days: z.array(UsageDay),
}).openapi('Usage');

export const IdParam = z.object({ id: z.string().min(1).max(64).openapi({ param: { name: 'id', in: 'path' } }) });
