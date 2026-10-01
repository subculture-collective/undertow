# Reliability work

Scope accepted after the September 30 repository review.

- [x] Serialize autosaves and ignore responses from previously opened projects.
- [x] Bind worker mutations to their current claim and protect output writes.
- [x] Reserve render limits in the creation transaction.
- [x] Reconcile failed, cancelled, expired and orphan render files.
- [x] Bound JSON and thumbnail bodies before buffering.
- [ ] Add regression checks and CI, update recovery docs, verify the private deployment.

Provider credentials and billing remain separate product setup work.

Verification before deployment includes PostgreSQL regressions, both builds,
six passing browser export checks, and restoration of the latest production
backup into a temporary database. The API and worker must deploy together;
there is no database schema migration in this change.
