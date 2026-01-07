# Firestore Backup Restore Test (Runbook)

This runbook documents how to perform a periodic **restore test** from Firestore managed backups and capture evidence for SOC 2 / DR readiness.

## Preconditions

- You have a managed backup schedule enabled (see `docs/compliance/GCP_EVIDENCE_COMMANDS.md`).
- You have permissions to list backups and restore databases in the target GCP project.
- You have a plan for how long the temporary restored database will exist (cost control).

## 0) (Recommended) Create a synthetic marker document ahead of time

To avoid handling customer data during the restore validation, create a dedicated collection with a synthetic marker doc (no PII). Ensure a scheduled backup runs **after** the marker doc is created.

Example (Firestore REST API):

- `export PROJECT_ID="<PROJECT_ID>"`
- `export ACCESS_TOKEN="$(gcloud auth print-access-token)"`
- `export RUN_ID="$(date -u +%Y%m%d-%H%M%S)"`
- `curl -sS -X POST \\`
  `-H "Authorization: Bearer $ACCESS_TOKEN" \\`
  `-H "Content-Type: application/json" \\`
  `"https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/dr_restore_test?documentId=run_$RUN_ID" \\`
  `--data-binary '{"fields":{"purpose":{"stringValue":"soc2_dr_restore_test"},"containsCustomerData":{"booleanValue":false}}}'`

## 1) Pick a backup to restore

List backups:

- `gcloud firestore backups list --project <PROJECT_ID> --location <LOCATION_ID>`

Choose a backup resource name like:

- `projects/<PROJECT_ID>/locations/<LOCATION_ID>/backups/<BACKUP_ID>`

If the backups list is empty (new schedule), you cannot restore yet. Either:
- Wait for the first scheduled backup to be created, then rerun this runbook, or
- Perform an interim export/import restore test (see Appendix) using a synthetic-only collection.

## 2) Restore into a temporary database

Pick a destination database ID (example):

- `restore-test-YYYYMMDD`

Restore:

- `gcloud firestore databases restore --project <PROJECT_ID> --source-backup <BACKUP_RESOURCE> --destination-database <DEST_DB_ID>`

Notes:
- Destination database is created in the same location as the backup.
- Do **not** restore into `(default)` for a test unless you have an approved downtime plan.

## 3) Validate the restore

Describe the restored database:

- `gcloud firestore databases describe --project <PROJECT_ID> <DEST_DB_ID>`

Validate a small set of known documents/collections exist.

Note: `gcloud firestore documents ...` commands are not available in current `gcloud` releases. Use the Firestore REST API instead:

- `export ACCESS_TOKEN="$(gcloud auth print-access-token)"`
- `curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \\`
  `"https://firestore.googleapis.com/v1/projects/<PROJECT_ID>/databases/<DEST_DB_ID>/documents/dr_restore_test?pageSize=5"`

Record:
- backup ID restored
- restore command
- restore start/end timestamps
- validation queries + outputs (redact any PII)

## 4) Cleanup

Delete the temporary database when finished:

- `gcloud firestore databases delete --project <PROJECT_ID> --database <DEST_DB_ID>`

Delete the synthetic marker doc from `(default)` if you created one (Firestore REST API):

- `curl -sS -X DELETE -H "Authorization: Bearer $ACCESS_TOKEN" \\`
  `"https://firestore.googleapis.com/v1/projects/<PROJECT_ID>/databases/(default)/documents/dr_restore_test/<DOC_ID>"`

## Appendix: Interim export/import restore test (when no managed backups exist yet)

This exercises restore procedures without requiring a managed backup to exist yet. Export/import only a synthetic collection to avoid handling customer data.

1) Export a synthetic-only collection (example: `dr_restore_test`) to a dedicated bucket/prefix:
   - `gcloud firestore export gs://<BUCKET>/<PREFIX> --collection-ids=dr_restore_test`

2) Create a temporary database:
   - `gcloud firestore databases create --database=<DEST_DB_ID> --location=<LOCATION_ID>`

3) Import into the temporary database:
   - `gcloud firestore import gs://<BUCKET>/<PREFIX> --database=<DEST_DB_ID> --collection-ids=dr_restore_test`

4) Validate with Firestore REST, then delete the temporary database and exported objects.

## Evidence template (copy/paste)

- Date:
- Project:
- Backup resource:
- Destination database:
- Restore initiated by:
- Restore command:
- Validation checks performed:
- Cleanup completed:
