# Deploying Undertow

Undertow ships as one container (`Dockerfile`), plus Postgres. The container applies pending database migrations at start, then serves the API under `/v1`, the reference at `/docs` and the editor itself.

## Preview placement

The preview runs on Dozor at `/srv/apps/undertow`, listening on
`10.0.0.57:3040`. Almaz serves `https://undertow.subcult.tv` through Caddy and
Cloudflare. The editor is publicly accessible and account routes use Undertow's
own authentication. The API, worker and PostgreSQL run as the `undertow`
Compose project. The following capacity snapshot informed the original placement
on September 29. Check current capacity before adding workers.

| Host | Load average (1 min) | Cores | Memory free | Notes |
|---|---|---|---|---|
| NUC | 3.14 | 4 threads | 12 GiB | `/srv` 84% full |
| Almaz | 6.93 | 8 threads | 16 GiB | GTX 1080 present, but `nvidia-smi` found no device |
| Dozor | 0.79 | 4 cores | 9.3 GiB | 60 GiB disk free |

Dozor has the most headroom. Its main job is central monitoring, so `deploy/compose.yml` caps the API at 512 MB and one CPU, and Postgres at 1 GB and one CPU. The API port binds to `127.0.0.1:8787` unless `UNDERTOW_BIND` says otherwise. When the edge runs on another host, bind to the LAN address the edge reaches, such as `10.0.0.57:3040`. The render worker is a separate container that pulls jobs from Postgres. It can start on Dozor with a two-CPU cap and move to another host later without changing the API.

After deploying, update the canonical host notes (see the homelab documentation policy) with the placement, the resource limits and a backup and rollback record.

## Steps

1. On the host, copy `deploy/undertow.env.example` to `deploy/undertow.env` and fill it in. Keep the real values in the existing secret store.
   - `AUTH_SECRET`: `openssl rand -base64 32`
   - `PUBLIC_URL`: the public origin, for example `https://undertow.example`. The OAuth callbacks and email links are built from it.
2. Run `docker compose -f deploy/compose.yml --env-file deploy/undertow.env -p undertow up -d --build`.
3. Point the edge at the `UNDERTOW_BIND` address, with TLS. With `NODE_ENV=production`, session cookies are `Secure`, so the site must be served over HTTPS.
4. Check `https://<host>/healthz` and `/docs`.
5. Back up PostgreSQL. It holds accounts, projects, API keys and render jobs. Render media is stored separately and is transient.

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

The deployed preview currently enables Google. Discord is disabled. Keep downloaded
Google `client_secret_*.json` files out of Git and Docker build contexts; copy their
values into the deployment environment instead.

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

Password reset and email confirmation need outgoing mail. Set `MAIL_FROM` and one of:

- `BREVO_API_KEY`: sends through Brevo's transactional API. The `MAIL_FROM` domain must be authenticated in Brevo, and the address must be an active sender. Brevo's free plan sends 300 emails a day.
- `SMTP_URL`: any SMTP server, for example `smtps://user:pass@smtp.example.com:465`.

`BREVO_API_KEY` wins if both are set. With neither, emails are printed to the API log. That's fine for development, but in production nobody could confirm their address.

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

## Backup and restore on Dozor

`undertow-postgres-backup.timer` runs nightly. Its service calls
`/usr/local/sbin/backup-undertow-postgres`, writes custom-format dumps under
`/srv/recovery/backups/undertow-postgres/<UTC timestamp>/`, checks the archive
with `pg_restore --list`, and records `SHA256SUMS`. The recovery HDD is on the
same host. An off-host backup remains additional recovery work.

Check the service and the chosen backup on Dozor:

```sh
systemctl show undertow-postgres-backup.service -p Result -p ExecMainStatus
sudo ls /srv/recovery/backups/undertow-postgres
# Substitute the backup directory selected above.
sudo sh -c 'cd /srv/recovery/backups/undertow-postgres/<timestamp> && sha256sum -c SHA256SUMS'
```

Restore into a new database first. Keep the live database intact while checking
the dump. On Dozor, with the timestamp substituted:

```sh
restore_database="undertow_restore_check_$(date -u +%Y%m%d%H%M%S)"
docker exec undertow-db-1 psql -U undertow -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $restore_database"
sudo cat /srv/recovery/backups/undertow-postgres/<timestamp>/undertow.dump \
  | docker exec -i undertow-db-1 pg_restore -U undertow -d "$restore_database" \
      --no-owner --no-privileges --exit-on-error
docker exec undertow-db-1 psql -U undertow -d "$restore_database" \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
```

For a recovery cutover, stop the API and worker before changing `DATABASE_URL`
in the API service's Compose environment to the restored database. Keep the
existing database and a copy of the previous configuration. Start the API and
worker together, check health, sign-in, project loading and a short render,
then confirm the backup script dumps the chosen database. Do not drop the old
database until the recovery has been accepted. A drill database can be dropped
after the checks with `DROP DATABASE <drill database name>`.

On September 30, the `20260930T091022Z` dump passed its checksum and restored
without errors into `undertow_restore_check_20261001`, with 12 public tables.
The drill database was then dropped. This verified database restoration, not
an application cutover or recovery of transient render media.

## Deployment and rollback

Before replacing the preview, record the revision in `DEPLOYED_COMMIT`, archive
its tracked source under `/srv/apps/undertow-releases/`, tag both existing images
as `undertow-api:rollback-<revision>` and `undertow-worker:rollback-<revision>`,
and take a fresh database backup. Keep `deploy/undertow.env` out of source
archives and Docker build contexts.

Build both new images before stopping either running service. Stop the worker,
then recreate API and worker together using the new images. The worker protocol
requires matching API and worker versions. Check container health, `/healthz`,
Prometheus's `probe_success{project="undertow"}`, the public authentication gate,
and a short render before recording the new deployment revision.

For an image rollback with no database schema change, extract the previous
source archive into a separate rollback directory, copy the protected env file
into its `deploy/` directory, and retag the retained images:

```sh
docker tag undertow-api:rollback-<revision> undertow-api:latest
docker tag undertow-worker:rollback-<revision> undertow-worker:latest
docker compose -f <rollback directory>/deploy/compose.yml \
  --env-file <rollback directory>/deploy/undertow.env -p undertow \
  up -d --no-build --force-recreate api worker
```

This retains the `undertow` project's existing database and render volumes.
Repeat the health and render checks and update `DEPLOYED_COMMIT` to the restored
revision. If a future release changes the database schema, review compatibility
before rolling images back. Use the restore procedure when an old image cannot
read the migrated database.
