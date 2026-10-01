# Undertow API

The editor and third-party apps use the same versioned API under `/v1`. The live reference, generated from the code, is at `/docs`. The raw OpenAPI 3.1 document is at `/v1/openapi.json`.

## Authentication

There are two ways to authenticate:

- **Browser session.** Signing in on the site sets an `ut.session_token` cookie. The editor uses this.
- **API key.** Send `Authorization: Bearer ut_…`, or `x-api-key: ut_…`. Create keys in the editor under Account → API keys, or with `POST /v1/keys` from a signed-in session. The full key appears once, at creation.

An API key acts for its owner, with one exception: keys can't create, list or revoke other keys. That needs a signed-in session, so a leaked key can't mint more.

```sh
curl -H "Authorization: Bearer $UNDERTOW_KEY" https://undertow.example/v1/projects
```

## Endpoints

| Area | Endpoints |
|---|---|
| Account | `GET /v1/me`, `PATCH /v1/me`, `GET`/`PUT /v1/me/defaults`, `GET /v1/me/connections`, `POST /v1/me/connections/{google,discord}/import` |
| Projects | `GET`/`POST /v1/projects`, `GET`/`PATCH`/`DELETE /v1/projects/{id}`, `POST /v1/projects/{id}/duplicate`, `GET`/`PUT /v1/projects/{id}/thumbnail` |
| Templates | `GET /v1/templates?scope=all\|builtin\|public\|mine`, `GET /v1/templates/{id}`, `POST /v1/templates`, `DELETE /v1/templates/{id}` |
| Palettes | `GET`/`POST /v1/palettes`, `DELETE /v1/palettes/{id}` |
| Presets | `GET /v1/presets/milkdrop?q=` |
| Rendering | `GET`/`POST /v1/renders`, `GET`/`DELETE /v1/renders/{id}`, `PUT /v1/renders/{id}/media/{mediaId}`, `POST /v1/renders/{id}/start`, `GET /v1/renders/{id}/output`. See [rendering.md](rendering.md) |
| Keys and usage | `GET`/`POST /v1/keys`, `DELETE /v1/keys/{id}`, `GET /v1/usage?days=30` |
| Service | `GET /v1/meta` (no auth), `GET /healthz` |
| Sign-in | `/v1/auth/*`, handled by Better Auth. Listed under "Auth" in `/docs` |

## Rendering in the cloud

```sh
# 1. Create the job: layout (or projectId), options, and every file the layout uses.
curl -X POST -H "Authorization: Bearer $UNDERTOW_KEY" -H 'content-type: application/json' \
  https://undertow.example/v1/renders -d @job.json
# 2. Upload each file listed in "uploads".
curl -X PUT -H "Authorization: Bearer $UNDERTOW_KEY" --data-binary @song.mp3 \
  https://undertow.example/v1/renders/rnd_…/media/song1
# 3. Start, then poll GET /v1/renders/rnd_… until status is "done", then download.
curl -X POST -H "Authorization: Bearer $UNDERTOW_KEY" https://undertow.example/v1/renders/rnd_…/start
curl -L -H "Authorization: Bearer $UNDERTOW_KEY" -o video.mp4 https://undertow.example/v1/renders/rnd_…/output
```

Files over 100 MB must go up in chunks when the API is behind Cloudflare. Send consecutive pieces with `?offset=` set to the bytes already sent; the `Upload-Offset` response header reports the running total:

```sh
split -b 48m song.wav part.
offset=0
for p in part.*; do
  curl -X PUT -H "Authorization: Bearer $UNDERTOW_KEY" --data-binary @"$p" \
    "https://undertow.example/v1/renders/rnd_…/media/song1?offset=$offset"
  offset=$((offset + $(wc -c < "$p")))
done
```

Files uploaded for a render are deleted when it finishes. This is the only part of the API that receives media.

## Projects store layouts, not media

A project holds the layout (`data`) and a `media` list naming the files it uses: `{ id, kind, name, size }`. The songs, images, clips and fonts themselves never reach the server. A client that opens a project matches `media` entries to files it has, by kind, name and size, and asks the user for the rest.

## Saving without overwriting

Every write increments `revision`. Send the revision you loaded as `baseRevision` in `PATCH /v1/projects/{id}`. If someone saved in between, the API returns `409` and writes nothing. Load the project again, or save yours as a new project. Leaving out `baseRevision` overwrites unconditionally.

## Pagination

`GET /v1/projects` returns `{ items, nextCursor }`. Pass `nextCursor` back as `cursor` until it's `null`. Pages come in most recently edited order and hold at most 100 items (`limit`, default 30).

## Errors

Errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details with `content-type: application/problem+json`:

```json
{ "type": "/problems/conflict", "title": "Conflict", "status": 409,
  "detail": "The project was saved elsewhere (now revision 2, you sent 1). Load it again or save as a copy." }
```

Validation failures are `422`. `detail` lists each failing field.

## Rate limits and plans

Each API key, or each signed-in user without a key, gets a per-minute request budget from its plan. Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds). Past the limit the API returns `429` with a `Retry-After` header.

| Plan | Requests/min | Projects | Templates | API keys | Cloud render minutes/month | Max resolution | Max length |
|---|---|---|---|---|---|---|---|
| free | 120 | 50 | 20 | 3 | 0 | none | none |
| creator | 600 | 500 | 200 | 10 | 120 | 4K | 15 min |

Plans are defined in `server/src/lib/plans.ts`. Stripe reconciliation updates
`profile.plan`, and request authorization checks the stored subscription status
and paid-period expiry. Every authenticated request is recorded in `usage_event`,
and `GET /v1/usage` summarises it per day. No metered overage billing is enabled.

`GET /v1/billing` reconciles the current subscription and reports its state and
price. `POST /v1/billing/checkout` starts or resumes Checkout, while
`POST /v1/billing/portal` opens subscription management. These routes require a
browser session, and POST requests require a trusted Origin. API keys cannot
initiate billing actions. Stripe posts signed events to `/v1/billing/webhook`.

The limiter keeps its counts in memory, which is correct for one API instance. Running several instances needs a shared store behind `take()` in `server/src/lib/rate-limit.ts`.

## Changing the API

- Routes are defined with zod schemas in `server/src/schemas.ts` and `server/src/routes/`. Those schemas both validate requests and generate the OpenAPI document.
- After changing a route, run `npm run api:types` from the repository root. That regenerates `src/api/schema.d.ts`, and the editor's type check catches anything the change broke.
- Additive changes (new fields, new endpoints) stay in `/v1`. Removing or renaming a field needs `/v2`.
