# Account Deletion Procedure (Runbook)

This runbook describes how to complete an account deletion request in production and capture evidence (SOC 2 / privacy readiness).

## Inputs

- User ID (`uid`)
- Deletion request record: `deletionRequests/{uid}`

## 1) Validate the request

- Confirm the request exists and is in `status: "requested"`.
- Confirm the requester’s identity via your support workflow.

## 2) Disable access (recommended)

- Disable the Firebase Auth user to prevent new sessions during deletion.
- Revoke refresh tokens / sessions if applicable (Firebase Admin supports revocation).

## 3) Delete customer data (Firestore + Storage)

Use the admin script:

- `tsx scripts/delete-user-data.ts --uid <uid> --dry-run`
- `tsx scripts/delete-user-data.ts --uid <uid>`

Expected deletions (high level):
- Firestore: `users/{uid}` document subtree (campaigns, gmailConnections, emailQueue, etc).
- Firestore: `pipeline_jobs` documents where `uid == <uid>`.
- Cloud Storage: objects under `pipeline_jobs/<jobId>/` for the user’s pipeline jobs (and any `users/<uid>/` prefixes if present).

Notes:
- Billing/financial records may need to be retained for legal/accounting reasons. Prefer anonymization over deletion where required.

## 4) Mark completion + retain evidence

Update:
- `deletionRequests/{uid}` → `status: "completed"`, `completedAt: <timestamp>`

Capture evidence:
- Script output summary (counts only; do not capture PII).
- Timestamp of completion.
- Confirmation that Gmail connections were removed and queued sends stopped.

