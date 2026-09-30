# Deploying Undertow

Undertow ships as one container (`Dockerfile`), plus Postgres. The container applies pending database migrations at start, then serves the API under `/v1`, the reference at `/docs` and the editor itself.

## Proposed placement

This is a proposal, not a deployment. Load observed on 2026-09-29 at 14:10:

| Host | Load average (1 min) | Cores | Memory free | Notes |
|---|---|---|---|---|
| NUC | 3.14 | 4 threads | 12 GiB | `/srv` 84% full |
| Almaz | 6.93 | 8 threads | 16 GiB | GTX 1080 present, but `nvidia-smi` found no device |
| Dozor | 0.79 | 4 cores | 9.3 GiB | 60 GiB disk free |

Dozor has the most headroom. Its main job is central monitoring, so `deploy/compose.yml` caps the API at 512 MB and one CPU, and Postgres at 1 GB and one CPU. The API port binds to `127.0.0.1:8787` unless `UNDERTOW_BIND` says otherwise. When the edge runs on another host, bind to the LAN address the edge reaches, such as `10.0.0.57:3040`. The future render worker is a separate container that pulls jobs from Postgres. It can start on Dozor with a two-CPU cap and move to another host later without changing the API.

After deploying, update the canonical host notes (see the homelab documentation policy) with the placement, the resource limits and a backup and rollback record.

## Steps

1. On the host, copy `deploy/undertow.env.example` to `deploy/undertow.env` and fill it in. Keep the real values in the existing secret store.
   - `AUTH_SECRET`: `openssl rand -base64 32`
   - `PUBLIC_URL`: the public origin, for example `https://undertow.example`. The OAuth callbacks and email links are built from it.
2. Run `docker compose -f deploy/compose.yml --env-file deploy/undertow.env -p undertow up -d --build`.
3. Point the edge at the `UNDERTOW_BIND` address, with TLS. With `NODE_ENV=production`, session cookies are `Secure`, so the site must be served over HTTPS.
4. Check `https://<host>/healthz` and `/docs`.
5. Back up the `undertow-db` volume, for example a nightly `pg_dump` shipped to the backup target. It holds accounts, projects and API keys. Media isn't stored server-side.

## Behind Cloudflare

Cloudflare rejects request bodies over 100 MB. The editor uploads render files in 48 MB chunks (`PUT …/media/{mediaId}?offset=N`), so larger files still get through. Auth rate limits read the visitor's address from `cf-connecting-ip`, then `x-forwarded-for`.

## Cloud rendering

The `worker` service in `deploy/compose.yml` renders queued jobs. How it works and how it fails are covered in [rendering.md](rendering.md).

- Set `WORKER_SECRET` in `deploy/undertow.env` (`openssl rand -hex 24`). The API and the worker must share the same value.
- The worker image is amd64 only, because Google publishes Chrome for Linux on amd64 only. Dozor is amd64.
- Render files live in the `undertow-renders` volume. Include it in backups only if you want finished videos to survive a restore. Outputs expire after `RENDER_OUTPUT_DAYS` anyway.
- The worker is capped at 2 CPUs and 2 GB of memory and runs one job at a time. To render faster or in parallel, run more workers on a host with spare capacity. They only need to reach the API.

## Sign-in providers

Leave a provider's variables empty to hide it. The editor only shows providers that `/v1/meta` reports as enabled.

**Google, which also covers YouTube**

- Create an OAuth client (type "Web application") in Google Cloud Console.
- Authorised redirect URI: `<PUBLIC_URL>/v1/auth/callback/google`.
- Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- "Connect YouTube" requests the `youtube.readonly` scope, which is used only to read the channel name.
  - Add that scope to the consent screen.
  - Google requires app verification before users outside the test list can grant it.

**Discord**

- Create an application at discord.com/developers, then open OAuth2.
- Redirect: `<PUBLIC_URL>/v1/auth/callback/discord`.
- Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

## Email

Password reset and email confirmation need outgoing mail. Set `SMTP_URL` (for example `smtps://user:pass@smtp.example.com:465`) and `MAIL_FROM`. Without `SMTP_URL`, emails are printed to the API log. That's fine for development, but in production nobody could confirm their address.

## Local development

```sh
docker compose up -d db              # Postgres on 127.0.0.1:5433
cp server/.env.example server/.env   # then set AUTH_SECRET
npm --prefix server install
npm --prefix server run db:migrate
npm run api:dev                      # API on :8787
npm run dev                          # editor on :5173; /v1, /internal and /docs are proxied to the API
EDITOR_URL=http://localhost:5173 npm --prefix server run worker   # cloud render worker (uses local Chrome)
```

Confirmation and reset links appear in the API log.
