# Data Retention and Deletion Policy (Engineering)

This document describes what data is stored, how long it is retained, and how deletion requests are handled.

## Data categories (high level)

- **Auth/session**: Firebase Auth identifiers; session cookies.
- **Google OAuth/Gmail**:
  - Refresh tokens stored **encrypted** in Firestore.
  - Access tokens stored **encrypted** in Firestore (defense-in-depth) and refreshed as needed.
- **Outreach**: queued email items, draft metadata, contact tracking.
- **Campaign/pipeline**: campaign configuration, pipeline results (Firestore + Storage).

## Retention principles

- Retain only what is required to provide the service and support billing/audit needs.
- Do not retain Google user data longer than necessary.
- Do not log Gmail message content, subjects, or recipients.
- Apply retention windows to queued outreach records (default: 30 days for processed/cancelled items).

## Deletion and revocation

- **Disconnect Gmail**:
  - Revoke tokens with Google where possible.
  - Delete stored Gmail connection/token material from Firestore.
  - Cancel queued emails tied to that Gmail connection and scrub queued recipients/subjects/bodies.
- **Delete campaign**:
  - Deletes the campaign document and its subcollections (including contacts/outreach/search/pipeline snapshots).
  - Deletes any queued email items tied to the campaign (`users/{uid}/emailQueue` where `campaignId == <campaignId>`).
  - Deletes associated pipeline job docs (`pipeline_jobs` where `campaign_id == <campaignId>`) and removes their Storage outputs (`pipeline_jobs/<jobId>/...`).
- **Queue retention**:
  - Processed queue items (sent/failed/cancelled) are automatically deleted after the configured retention window (default 30 days).
- **Account deletion request**:
  - User can request deletion in-product via `POST /api/user/delete` (requires `{ "confirm": "DELETE" }`).
  - The request is recorded in Firestore (`deletionRequests/{uid}`) for audit/evidence.
  - In emulator/E2E mode, the endpoint performs immediate deletion of Firestore user data and pipeline job docs.
  - In production, deletion is completed via support/ops procedure (Firestore + Storage), with completion timestamps recorded.

## Evidence

- Record deletion requests and completion timestamps.
- Maintain a restore procedure test record for backups.
