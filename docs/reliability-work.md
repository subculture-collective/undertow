# Reliability work

Scope accepted after the September 30 repository review.

- [x] Serialize autosaves and ignore responses from previously opened projects.
- [x] Bind worker mutations to their current claim and protect output writes.
- [x] Reserve render limits in the creation transaction.
- [x] Reconcile failed, cancelled, expired and orphan render files.
- [x] Bound JSON and thumbnail bodies before buffering.
- [x] Add regression checks and CI, update recovery docs, verify the private deployment.

Provider credentials and billing remain separate product setup work.

Verification before deployment includes PostgreSQL regressions, both builds,
six passing browser export checks, and restoration of the latest production
backup into a temporary database. The API and worker must deploy together;
there is no database schema migration in this change.

September 30 verification on Dozor:

- All 14 regression tests passed locally and in Gitea CI. The first CI run
  exposed missing service-name DNS on the runner's default Docker bridge;
  the disposable database script now uses its container address there.
- Both production images built successfully. The API container is healthy,
  and Prometheus reports `probe_success{project="undertow"}=1`.
- A temporary creator account uploaded a synthetic two-second song in two
  chunks, queued a render through the API, and downloaded the completed output.
  `ffprobe` reported H.264 video at 1280 by 720, AAC audio and 2.000 seconds.
  The account, key and render files were removed afterward.
- Previous source and both rollback image tags are retained under revision
  `9719752`. A fresh database backup succeeded before the rollout.

The public site remains behind Authelia. Outgoing email delivery and external
OAuth providers were not exercised. The backup restore drill checked database
restoration, not an application recovery cutover.
