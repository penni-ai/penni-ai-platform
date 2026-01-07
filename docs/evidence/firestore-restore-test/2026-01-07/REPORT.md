# Firestore Restore Test Evidence (2026-01-07)

Project: `penni-ai-platform`  
Initiated by: `admin@penni-ai.com`  
Default database location: `nam5`

## Managed backups status (runbook step 1)

- Backup schedules: `docs/evidence/firestore-restore-test/2026-01-07/01-backup-schedules.json`
- Managed backups list (none available yet):
  - `docs/evidence/firestore-restore-test/2026-01-07/02-managed-backups-nam5.json`
  - `docs/evidence/firestore-restore-test/2026-01-07/02-managed-backups-all.json`

Because there were no managed backup resources available to restore, the remainder of this run records an **export/import restore test** of a synthetic-only collection as interim DR evidence. Re-run the managed-backup restore once the first scheduled backup exists.

## Export/import restore test (synthetic-only)

Test collection: `dr_restore_test`  
Test document ID: `run_20260107-094456` (containsCustomerData=false)  
Export prefix: `gs://penni-ai-platform-firestore-exports/exports/20260107-094456`  
Destination database: `restore-test-20260107-094456`

### Evidence artifacts (commands + outputs)

**Environment**
- `docs/evidence/firestore-restore-test/2026-01-07/00-env.txt`
- `docs/evidence/firestore-restore-test/2026-01-07/vars.txt`

**Export bucket posture**
- `docs/evidence/firestore-restore-test/2026-01-07/03-export-bucket.json`
- `docs/evidence/firestore-restore-test/2026-01-07/03-export-bucket-iam.json`

**1) Create test document in `(default)`**
- Request: `docs/evidence/firestore-restore-test/2026-01-07/04-create-test-doc.request.json`
- Response: `docs/evidence/firestore-restore-test/2026-01-07/04-create-test-doc.response.json`

**2) Export `dr_restore_test`**
- Export op: `docs/evidence/firestore-restore-test/2026-01-07/05-firestore-export.json`
- Export timestamps: `docs/evidence/firestore-restore-test/2026-01-07/05-firestore-export.timestamps.txt`
- Export operation (done/success): `docs/evidence/firestore-restore-test/2026-01-07/05-firestore-export.operation.describe.json`

**3) Create destination database**
- Create op: `docs/evidence/firestore-restore-test/2026-01-07/06-create-database.json`
- Operation describe: `docs/evidence/firestore-restore-test/2026-01-07/06-create-database.operation.describe.json`
- Database describe: `docs/evidence/firestore-restore-test/2026-01-07/06-create-database.describe.json`

**4) Import into destination database**
- Import op: `docs/evidence/firestore-restore-test/2026-01-07/07-firestore-import.json`
- Import timestamps: `docs/evidence/firestore-restore-test/2026-01-07/07-firestore-import.timestamps.txt`
- Import operation (done/success): `docs/evidence/firestore-restore-test/2026-01-07/07-firestore-import.operation.describe.json`

**5) Validate restored data (Firestore REST API)**
- Get restored doc: `docs/evidence/firestore-restore-test/2026-01-07/08-validate-restored-doc.json`
- List restored collection: `docs/evidence/firestore-restore-test/2026-01-07/08-validate-restored-docs-list.json`

**6) Cleanup**
- Delete restored database: `docs/evidence/firestore-restore-test/2026-01-07/09-delete-restored-database.log`
- Delete test doc from `(default)`: `docs/evidence/firestore-restore-test/2026-01-07/10-delete-test-doc.txt`
- Delete export objects: `docs/evidence/firestore-restore-test/2026-01-07/11-delete-export-objects.log`

## Notes

- This restore test exported/imported only the synthetic `dr_restore_test` collection; it did not export or validate customer collections (to avoid handling PII in evidence).
- The export bucket uses uniform bucket-level access and `public_access_prevention=enforced`, with a lifecycle rule to delete objects after 7 days.
