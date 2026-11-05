# Automatic preview delivery

The existing required `Reliability checks / check` job retains both dependency
audits, frontend/API builds and the full suite against disposable PostgreSQL.
It also builds the actual application image and runs its migrations, health and
all packaged public-file checks in an isolated candidate. Only a successful push
or workflow dispatch on canonical main can receive and activate an image.

The fixed receiver selects only service `api` in project `undertow`. PostgreSQL
and the existing render volume remain attached through the reviewed baseline.
No worker is started. The gate refuses promotion while a render worker or an
awaiting-upload, queued or running job exists. A worker release uses the native
paired API/worker procedure. A migration-changing image is refused before backup;
native database admission is required before image-only rollback is safe again.

## Data gate

The versioned `scripts/predeploy-ci.py` hook must be installed from the exact
green merged source at the path/hash in the host registration. A missing hook
fails before activation. It checks the original private environment-file hash,
compares all migration files and the compiled migrator with the live API, and
takes a native consistent custom-format PostgreSQL dump plus the quiescent render
archive. Source data and volumes stay in place.

The hook backs up those files, the original environment store and deployment
configuration through Dozor's existing encrypted Restic repository on Kvant.
It references the existing password file; it does not copy a password into CI or
source. Both archives are retrieved and compared byte-for-byte. The database is
restored into a new disposable PostgreSQL instance using the live database's
immutable image. Render files are restored into a private copy. The candidate
runs only those copies, on an internal network, with mail, OAuth, Stripe and
worker credentials omitted. Schema, every restored table's record count and row
fingerprint must remain unchanged after startup and public-file checks.

The native database and provider configuration are never supplied to the test
candidate. No account, email, payment or render request is made in production.
Root Restic operations have their own deadline; the receiver also bounds the
hook. Both fixture container types have internal expiry and automatic removal,
including when their controller is killed. No retention deletion, `forget` or
pruning is run by the hook. Existing backup and maintenance timers retain their
separate schedules.

## Scope and recovery

The scoped key permits only Kvant's LAN source, the pinned receiver and the
`undertow` profile. It refuses a shell and worker-service selection. The operator
owns its review/rotation on February 3, 2027. Gitea stores only
`HOMELAB_DEPLOY_KEY` and `HOMELAB_KNOWN_HOSTS` for deployment; native credentials
stay in `/srv/apps/undertow/deploy/undertow.env`.

Private profile/baseline files are `~/.config/fleet-deploy/undertow.json` and
`~/.config/fleet-deploy/undertow-compose.json`. Registration and receipts live
under `~/.local/state/fleet-deploy/undertow/`. Data qualification checkpoints and
archives live under `/srv/recovery/backups/undertow-ci/`. The baseline keeps
references to the original private environment file instead of copying values.

Current-main identity, source labels, immutable artifact reuse, an application
lock and the runtime guard precede activation. The receiver compares complete
public image HTML plus the exact existing 44-byte Umami head insertion. Icons
match raw image bytes. A failed activation restores the previous immutable API
image and verifies its public checks. It does not roll back a database; unchanged
migration admission is therefore mandatory.

After main CI succeeds, independently verify public files and metadata, API
contracts, native environment and runtime configuration, persistent storage and
related service identities. Image/HTTP checks do not qualify a fresh cloud render,
paid billing or provider lifecycle. Those retain their existing procedures.
