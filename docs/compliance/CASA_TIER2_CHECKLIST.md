# CASA (Tier 2) Readiness Checklist (Google OAuth / Gmail)

This is a practical, engineering-focused checklist to prepare for Google OAuth verification + CASA where applicable. It is not legal advice and not a substitute for an auditor/security assessor.

## 1) Scope minimization (CASA critical)

- Confirm the OAuth consent screen requests only required scopes.
- If you can meet your product requirements with `gmail.compose` only, avoid adding broader scopes.
- Maintain a written justification for each scope (reviewers will ask).

## 2) Google API Services User Data Policy / Limited Use

In-product + policy disclosures should clearly state:

- What Google user data you access (e.g., email address, draft content, message metadata) and why.
- Where it is stored (Firestore, logs) and how it is protected (encryption, access controls).
- Whether you share it with any third parties (e.g., LLM providers) and under what constraints.
- How users revoke access and how data is deleted/retained.

Status in this repo (branch `casa-readiness`):
- Privacy Policy disclosure added: `src/routes/privacy/+page.svelte`
- In-product disclosure added: `src/routes/(app)/my-account/gmail/+page.svelte`

Out-of-repo checklist:
- Ensure OAuth consent screen “App domain” links and text match these disclosures.
- Ensure the verified domain is correct and the privacy policy URL is on the verified domain.

## 3) Token handling & storage

- Refresh tokens must be stored encrypted (at rest) and never logged.
- Access tokens should be treated as secrets; avoid storing longer than needed and avoid logging.
- Encryption key management:
  - Store the token encryption key in Secret Manager.
  - Define a key rotation plan and a re-encryption strategy (if you rotate keys).
  - Prefer runtime-only secret exposure (avoid passing token encryption keys into build environments).

Status in this repo (branch `casa-readiness`):
- AES-256-GCM refresh token encryption: `src/lib/server/gmail/gmail-auth.ts`
- Access tokens are encrypted at rest (defense-in-depth): `src/lib/server/gmail/gmail-auth.ts`, `services/pipeline-service/src/handlers/email-queue-cron.ts`
- Key rotation runbook + migration script: `docs/runbooks/GMAIL_TOKEN_ENCRYPTION_KEY_ROTATION.md`, `scripts/rotate-gmail-token-encryption-key.ts`
- Log redaction (key-based + token-pattern): `src/lib/server/core/logger.ts`, `services/pipeline-service/src/utils/logger.ts`

## 4) CSRF / request integrity

All cookie-authenticated state changes should be protected with origin checks.

Status in this repo (branch `casa-readiness`):
- Origin checks added:
  - `src/routes/api/auth/gmail/disconnect/+server.ts`
  - `src/routes/api/auth/gmail/primary/+server.ts`
  - `src/routes/api/outreach/send/+server.ts`
- Audited remaining state-changing endpoints; webhook endpoints rely on signature/auth instead of Origin checks.

## 5) Email safety (header injection, content)

- Prevent header injection by stripping CR/LF from `To/From/Subject`.
- Validate recipient addresses.

Status in this repo (branch `casa-readiness`):
- Sanitization added:
  - `src/lib/server/gmail/gmail-sender.ts`
  - `services/pipeline-service/src/handlers/email-queue-cron.ts`

## 6) Revocation, deletion, retention

- User must be able to disconnect Google access (revocation).
- Define and implement retention windows for:
  - Gmail connection metadata (account email, connection timestamps)
  - Stored tokens (access/refresh)
  - Queued outreach emails and drafts

Status in this repo (branch `casa-readiness`):
- Disconnect triggers queued-email cancellation for the revoked connection:
  - `src/lib/server/gmail/gmail-auth.ts`
  - `src/lib/server/email-queue/queue-service.ts`
- Disconnect scrubs queued recipients/subjects/bodies for that connection (minimize retained message data).
- Processed queue items are automatically cleaned up after the configured retention window (default 30 days): `services/pipeline-service/src/handlers/email-queue-cron.ts`
- Campaign deletion cascades to campaign subcollections, deletes campaign-tied email queue items, and deletes campaign pipeline job docs + Storage outputs: `src/routes/api/campaigns/[id]/+server.ts`
- Account deletion request endpoint exists (`POST /api/user/delete`), records deletion requests, and performs immediate deletion in emulator/E2E.
- Ops deletion completion runbook: `docs/runbooks/ACCOUNT_DELETION_PROCEDURE.md`

Remaining:
- Decide and document retention windows and deletion behavior (what is deleted immediately vs retained for audit/billing).
- Ensure privacy policy language matches reality (e.g., avoid claiming you store user passwords if Firebase Auth handles them).
- Ensure “debug/test” endpoints are not deployed to production.

## 7) Infrastructure expectations (CASA/SOC2 posture)

Minimum expectations:
- Runtime identities are least-privileged.
- Secrets are not plaintext env vars.
- Audit logging and monitoring are enabled.

Observed via `gcloud` (penni-ai-platform):
- App Hosting backend (`penni-ai-platform-backend`) runs as `firebase-app-hosting-compute@...`; project-level Token Creator was removed (self-binding only) and Secret Manager access was scoped to per-secret IAM.
- Cloud Scheduler job `email-queue-processor` uses OIDC and is authorized to invoke `pipeline-service` (invoker IAM is configured).
- Project IAM policy audit logging posture is explicitly configured (Secret Manager data access + Datastore/Firestore writes).
- Firebase Storage bucket uses uniform bucket-level access and `public_access_prevention=enforced` to prevent accidental public exposure.

## 8) Reviewer package (out-of-repo)

- Video walkthrough (OAuth connect → feature use → disconnect).
- Test account credentials and clear reviewer steps.
- Support contact and escalation path.
- If restricted scopes apply, complete the required third-party security assessment.
