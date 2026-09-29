# Deploying Undertow

Undertow ships as one container (`Dockerfile`), plus Postgres. The container applies pending database migrations at start, then serves the API under `/v1`, the reference at `/docs` and the editor itself.

## Proposed placement

This is a proposal, not a deployment. Load observed on 2026-09-29 at 14:10:

| Host | Load average (1 min) | Cores | Memory free | Notes |
|---|---|---|---|---|
| NUC | 3.14 | 4 threads | 12 GiB | `/srv` 84% full |
| Almaz | 6.93 | 8 threads | 16 GiB | GTX 1080 present, but `nvidia-smi` found no device |
| Dozor | 0.79 | 4 cores | 9.3 GiB | 60 GiB disk free |

Dozor has the most headroom. Its main job is central monitoring, so `deploy/compose.yml` caps the API at 512 MB and one CPU, and Postgres at 1 GB and one CPU. The API port binds to `127.0.0.1` only. The Almaz edge would proxy the public hostname to it, the same way as other public services. The future render worker is a separate container that pulls jobs from Postgres. It can start on Dozor with a two-CPU cap and move to another host later without changing the API.

After deploying, update the canonical host notes (see the homelab documentation policy) with the placement, the resource limits and a backup and rollback record.

## Steps

1. On the host, copy `deploy/undertow.env.example` to `deploy/undertow.env` and fill it in. Keep the real values in the existing secret store.
   - `AUTH_SECRET`: `openssl rand -base64 32`
   - `PUBLIC_URL`: the public origin, for example `https://undertow.example`. The OAuth callbacks and email links are built from it.
2. Run `docker compose -f deploy/compose.yml --env-file deploy/undertow.env up -d --build`.
3. Point the edge at `127.0.0.1:8787` on the host, with TLS. With `NODE_ENV=production`, session cookies are `Secure`, so the site must be served over HTTPS.
4. Check `https://<host>/healthz` and `/docs`.
5. Back up the `undertow-db` volume, for example a nightly `pg_dump` shipped to the backup target. It holds accounts, projects and API keys. Media isn't stored server-side.

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
npm run dev                          # editor on :5173; /v1 and /docs are proxied to the API
```

Confirmation and reset links appear in the API log.
