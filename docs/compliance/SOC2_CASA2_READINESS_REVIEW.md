# SOC 2 + CASA (Tier 2) Readiness Review (Code + GCP Config)

This document is a **readiness/gap** review based on the current repository contents (application code, Firebase/App Hosting config, Cloud Run/Cloud Build scripts, and Firestore/Storage rules). It is **not** a formal audit opinion.

## Scope observed in this repo

**Primary services**
- SvelteKit app deployed via Firebase App Hosting (Cloud Run backend).
- Cloud Run service: `services/pipeline-service` (Express) using Cloud Tasks, Firestore, Cloud Storage, Secret Manager, and external vendors (Weaviate, BrightData, OpenAI/DeepInfra).

**Key data types**
- User account identifiers (Firebase Auth), campaign data, influencer profile data, outreach recipient data.
- Gmail OAuth tokens (refresh token + access token) and Gmail sending/draft actions.
- Billing/subscription metadata (Stripe).

## Executive summary (what will block SOC 2 and CASA fastest)

1) **Pipeline job authorization (multi-tenant isolation) — fixed on `casa-readiness`**
- `src/routes/api/pipeline/[pipelineId]/+server.ts` now treats `pipeline_jobs/{pipelineId}.uid` as the source-of-truth and returns `404 PIPELINE_NOT_FOUND` when missing/mismatched (prevents cross-tenant bypass + enumeration).
- Removed the unsafe “campaign fallback” and verbose debug logging.

2) **Public test/debug surface — fixed on `casa-readiness`**
- `src/routes/api/public/test-search/+server.ts` is now blocked unless running in emulator mode or `E2E_TESTING=true`.

3) **GCP least-privilege + network hygiene gaps (partially fixed)**
- Removed project-level `roles/iam.serviceAccountTokenCreator` from `firebase-app-hosting-compute@...` (kept self-binding only).
- Removed project-level `roles/iam.serviceAccountTokenCreator` from `firebase-adminsdk-...` (kept self-binding only).
- Removed default VPC firewall rules allowing SSH/RDP/ICMP from `0.0.0.0/0` (`default-allow-ssh`, `default-allow-rdp`, `default-allow-icmp`).
- Scoped Secret Manager access to per-secret IAM (removed project-wide `roles/secretmanager.secretAccessor`).
- Enforced Cloud Storage Public Access Prevention on the Firebase Storage bucket (`public_access_prevention=enforced`).

4) **Operational controls are incomplete for audit evidence (partially fixed)**
- Project IAM policy audit logging posture is now explicitly configured:
  - `secretmanager.googleapis.com`: `ADMIN_READ`, `DATA_READ`, `DATA_WRITE`
  - `datastore.googleapis.com`: `DATA_WRITE`
- Firestore managed backups schedule is configured (daily, 30d retention).
- App log retention (`_Default` bucket) is 90 days.
- CI workflows are present in-repo, but enforcement still depends on GitHub branch protections/required checks.

## What has already been fixed on branch `casa-readiness`

- Removed tracked PII/artifact files and added `.gitignore` rules to prevent reintroduction.
- Fixed pipeline job ownership enforcement and removed unsafe “campaign fallback” (`src/routes/api/pipeline/[pipelineId]/+server.ts`, `src/routes/api/pipeline/[pipelineId]/cancel/+server.ts`).
- Added origin checks via `assertSameOrigin()` to state-changing Gmail and outreach endpoints.
- Prevented email header injection by sanitizing `to/from/subject` inputs and stripping CR/LF.
- Implemented token revocation cleanup: disconnecting Gmail cancels queued email items for that connection.
- Reduced Gmail connected logging to `email_domain` only (no full address).
- Added Google API Services User Data Policy / Limited Use disclosures:
  - Privacy Policy page.
  - In-product disclosure on Gmail connections page.
- Disabled public `test-search` outside emulator/E2E (`src/routes/api/public/test-search/+server.ts`).
- Added log redaction (key-based + token-pattern) in both the app and pipeline-service structured loggers.
- Tightened Firestore rules for server-managed collections (`firestore.rules`):
  - `checkoutSessions/{sessionId}` read restricted to the owning user (`firebaseUid`).
  - `pipeline_jobs/{pipelineId}` client reads disabled (access via server API only).

## SOC 2 control mapping (readiness)

This is a practical mapping to common SOC 2 “Security” criteria groupings (names vary slightly by auditor).

### CC6 — Logical access controls

**What you have**
- Session cookies via Firebase Admin (`src/routes/api/public/session/+server.ts`, `src/hooks.server.ts`).
- Default-deny Firestore rules with per-user access boundaries (`firestore.rules`).
- Cloud Run services are deployed with `--no-allow-unauthenticated` (`services/pipeline-service/cloudbuild.yaml`).

**Gaps**
- Authorization bug in pipeline results endpoint (fixed on `casa-readiness`).
- Runtime IAM should remain under periodic review (Token Creator roles are scoped to self-bindings; Secret Manager access is per-secret).
- No documented access review process (org/process item).

**Evidence to plan for**
- IAM role inventory exports + monthly review signoff.
- Firebase console role export + review cadence.

### CC7 — System operations (monitoring, detection, incident response)

**What you have**
- Structured logging patterns for pipeline (`docs/PIPELINE_LOGGING.md`, `services/pipeline-service/src/utils/logger.ts`).
- Health endpoints for services.
- Lightweight incident response runbook (`docs/policies/INCIDENT_RESPONSE.md`).

**Gaps**
- Alerting baseline is configured (Cloud Run 5xx, Cloud Scheduler failures, IAM `SetIamPolicy` changes), but runbooks/on-call adoption + evidence are still needed (tabletop exercises count).
- Audit logging posture is explicitly set (see Executive summary); still add periodic reviews and tune additional alerts (e.g., elevated auth failures, unusual admin activity).
- Define a “PII in logs” policy and enforce it across all services.
- Some application logs may include identifiers; verbose pipeline debug logging was removed on `casa-readiness` but continue auditing.
- Log retention for the application log bucket (`_Default`) is 90 days (consider 180 days if required for your evidence/IR posture).

**Evidence to plan for**
- Cloud Monitoring alert policies (screenshots/exports) + on-call procedures.
- Incident response runbook + incident ticket evidence (even tabletop exercises count).

### CC8 — Change management

**What you have**
- Tests exist (Vitest + e2e folders), but enforcement unknown.

**Gaps**
- CI workflows exist (`.github/workflows/ci.yml`, `.github/workflows/security.yml`), but required checks and branch protections must be configured in GitHub.
- No release/deployment approval flow described (Cloud Build runs, but triggers/approvals not codified here).

**Evidence to plan for**
- GitHub branch protection + required reviews.
- CI logs of tests/lint/scans on PRs.
- Deployment logs (Cloud Build/Run revision history).

### CC9 — Risk mitigation (vendors, data handling, resilience)

**What you have**
- Secret Manager is used for several API keys (`services/pipeline-service/cloudbuild.yaml`, `apphosting.yaml`).
- Storage rules are default deny (`storage.rules`).
- Privacy Policy and Terms routes exist (`src/routes/privacy/+page.svelte`, `src/routes/terms/+page.svelte`).
- Backup restore test runbook exists (`docs/runbooks/FIRESTORE_BACKUP_RESTORE_TEST.md`).

**Gaps**
- Third-party vendor management policy exists but needs adoption + evidence (OpenAI, BrightData, Weaviate, Stripe, etc.) (`docs/policies/VENDOR_MANAGEMENT.md`).
- Restore testing must be performed and evidenced for Firestore/Storage (see runbook).

**Evidence to plan for**
- Vendor list + DPAs/ToS acceptance + risk reviews.
- Backup policy + restore test logs/screenshots.

## CASA (Tier 2) / Google OAuth control mapping (readiness)

CASA readiness hinges on (1) scope classification, (2) disclosures/policy compliance, and (3) security posture.

### OAuth scopes + least privilege

**What you have**
- Uses `gmail.compose` + optional `gmail.send` and supports “draft-only” connections (`src/lib/server/gmail/gmail-auth.ts`).

**Gaps**
- Confirm in Google Cloud Console that only necessary scopes are configured and justified.

### Data storage and protection

**What you have**
- Refresh token encryption with AES-256-GCM (`src/lib/server/gmail/gmail-auth.ts`).
- Access tokens are encrypted at rest in Firestore (defense-in-depth) and refreshed as needed (`src/lib/server/gmail/gmail-auth.ts`, `services/pipeline-service/src/handlers/email-queue-cron.ts`).
- Gmail connection docs are not client-readable via Firestore rules (default-deny; no explicit allow for `gmailConnections`).

**Gaps**
- Access tokens are stored (encrypted) in Firestore; treat as sensitive and avoid logging.
- Ensure the key rotation runbook is followed and evidenced when rotating `GMAIL_TOKEN_ENCRYPTION_KEY` (`docs/runbooks/GMAIL_TOKEN_ENCRYPTION_KEY_ROTATION.md`).

### User disclosure, privacy policy, and Limited Use

**What you have**
- Explicit Google API Services User Data Policy / “Limited Use” disclosures:
  - `src/routes/privacy/+page.svelte`
  - `src/routes/(app)/my-account/gmail/+page.svelte`

**Gaps**
- Ensure the OAuth consent screen text and verification package match these disclosures (out-of-repo).
- Add/confirm a clear data retention/deletion statement for Google user data (tokens, drafts/queued outreach) and ensure it matches implementation (in-product + policy docs).

### Revocation and deletion

**What you have**
- Disconnect endpoint + token revocation path exists (`src/routes/api/auth/gmail/disconnect/+server.ts`, `src/lib/server/gmail/gmail-auth.ts`).
- Disconnect cancels and scrubs queued outreach content for the disconnected Gmail connection (`src/lib/server/email-queue/queue-service.ts`).
- Processed queue items are cleaned up after the configured retention window (default 30 days) via cron (`services/pipeline-service/src/handlers/email-queue-cron.ts`).
- Account deletion request endpoint records deletion requests (`src/routes/api/user/delete/+server.ts`) and performs immediate deletion in emulator/E2E.

**Gaps**
- Define and document retention windows for Gmail connections and queued email records (what is deleted immediately vs retained for billing/audit).

## High-risk findings (fix first)

### A. PII/data artifacts committed to Git (critical)

Status:
- These tracked artifacts have been removed and added to `.gitignore` on branch `casa-readiness`.

Remaining risk:
- Git history may still contain older versions of these files (auditors will ask about potential exposure).

Recommended remediation:
- Decide whether to rewrite history with `git filter-repo` (recommended if any real user/customer data existed).
- Add CI secrets/data scanning (gitleaks/trufflehog) to prevent recurrence.

### B. Gmail OAuth + token handling (CASA-related)

Observed strengths:
- Refresh tokens are encrypted with AES-256-GCM in `src/lib/server/gmail/gmail-auth.ts`.
- Firestore rules do **not** grant client access to `users/{uid}/gmailConnections` by default (good).
- Disconnect/revocation flows exist.
- Scopes are limited to `gmail.compose` and optional `gmail.send`.

Gaps:
- Key rotation runbook + migration script exist for `GMAIL_TOKEN_ENCRYPTION_KEY` (`docs/runbooks/GMAIL_TOKEN_ENCRYPTION_KEY_ROTATION.md`, `scripts/rotate-gmail-token-encryption-key.ts`).
- Ensure the OAuth consent screen + verification package align with in-product and privacy disclosures (out-of-repo).
- Define retention/deletion windows for Gmail connection records and queued email data (disconnect now cancels + scrubs queued items for that connection).

Files to review:
- `src/lib/server/gmail/gmail-auth.ts`
- `src/lib/server/gmail/gmail-sender.ts`
- `src/routes/api/auth/gmail/connect/+server.ts`
- `src/routes/api/auth/gmail/disconnect/+server.ts`
- `src/routes/api/auth/gmail/primary/+server.ts`
- `src/routes/privacy/+page.svelte`

### C. Email header injection risk (security)

Status:
- Header injection defenses have been added on `casa-readiness` by stripping CR/LF and sanitizing recipient/subject fields before MIME header assembly.

### D. CSRF and origin checks (cookie-auth integrity)

Your `assertSameOrigin()` helper exists and is used across cookie-authenticated state-changing endpoints. Webhook endpoints rely on signature/auth instead of Origin checks.

Remediation:
- Require `assertSameOrigin()` for **every** state-changing endpoint that uses cookie auth (POST/PUT/PATCH/DELETE), unless it is a webhook endpoint with a separate auth mechanism.

### E. GCP IAM + reliability gaps (observed via `gcloud`)

Key findings:
- Cloud Run invokers are **not public** (good), and Cloud Scheduler is authorized to call `pipeline-service` (good).
- Removed project-level `roles/iam.serviceAccountTokenCreator` from `firebase-app-hosting-compute@...` (kept self-binding only).
- Removed project-level `roles/iam.serviceAccountTokenCreator` from `firebase-adminsdk-...` (kept self-binding only).
- Removed project-level `roles/secretmanager.secretAccessor`; runtime access is now granted per-secret.
- `pipeline-service` has Gmail secret/env wiring via Secret Manager (`GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_CLIENT_ID`).
- Removed default VPC firewall rules allowing SSH/RDP/ICMP from `0.0.0.0/0` (no Compute Engine instances observed).
- Firestore backup schedules are configured (daily, 30d retention).
- Project IAM policy audit logging posture is explicitly configured (Secret Manager data access + Datastore/Firestore writes).
- Firebase Storage bucket has `public_access_prevention=enforced` + uniform bucket-level access.

Remediation:
- Scope runtime IAM down (especially Token Creator + Secret Manager access).
- Remove unused default network firewall rules.
- Decide on audit logging posture (Data Access logs for Firestore/Secret Manager/Storage as needed).
- Configure Firestore managed backups and test restore.

### F. Pipeline job ownership checks (critical) — fixed on `casa-readiness`

`src/routes/api/pipeline/[pipelineId]/+server.ts` and `src/routes/api/pipeline/[pipelineId]/cancel/+server.ts` now treat `pipeline_jobs/{pipelineId}.uid` as the source-of-truth and return `404 PIPELINE_NOT_FOUND` when missing/mismatched (prevents cross-tenant bypass + enumeration).

Follow-ups:
- Ensure pipeline job creation always sets `uid` (avoid legacy null-uid jobs).
- If legacy null-uid jobs exist, backfill via a safe admin-only repair job (never by trusting user-provided campaign docs).

### G. Public test endpoint (critical) — fixed on `casa-readiness`

`src/routes/api/public/test-search/+server.ts` is now blocked unless running in emulator mode or `E2E_TESTING=true` (returns `403 TEST_SEARCH_DISABLED` otherwise).

Follow-ups:
- Ensure production deployments never set `E2E_TESTING=true`.
- Prefer removing the route from production builds entirely if it’s only needed for local testing.

## Medium-risk findings (important for audit readiness)

### Logging and privacy
- Log redaction (key-based + token-pattern) is now enforced in code on `casa-readiness` (app + pipeline-service).
- Some logs may still include user identifiers; treat this as PII and keep it minimal/justified.

Remediation:
- Establish a “no PII in logs” default; allow explicit, justified exceptions (hash/email domain only).

### CI/CD and change management evidence
SOC 2 auditors will expect evidence of:
- PR reviews and branch protections
- Automated tests and build checks
- Dependency and vulnerability scanning
- Secrets scanning

Remediation:
- Add CI workflows and make them required checks (workflows added; enforce via branch protection).
- Keep an auditable trail of deployments (Cloud Build triggers + approvals).

### Configuration drift / IaC
Current infra is primarily scripted via `gcloud` shell scripts.

Remediation:
- Move critical infrastructure to Terraform/Pulumi (at least IAM, Cloud Run services, Cloud Tasks queues, scheduler jobs, Secret Manager bindings).
- Add environment-specific modules and a controlled promotion flow.

## CASA (Tier 2) readiness checklist (practical)

If you are pursuing CASA due to sensitive/restricted Gmail scopes:
- **Scopes**: confirm your OAuth consent screen only requests the minimum needed (you already split `draft` vs `send`).
- **App verification package**:
  - Privacy Policy page includes Google API User Data Policy and Limited Use disclosures.
  - In-product disclosure describing what Google data is accessed and why.
  - Video demo of the OAuth flow and feature usage.
  - Test user credentials for the reviewer.
- **Security posture**:
  - No customer data in source control.
  - Strong access controls, logging, incident response, vulnerability management.
  - Encryption at rest/in transit for stored tokens and user data.
- **Revocation + deletion**:
  - User can disconnect Gmail (implemented).
  - Account deletion request endpoint + ops runbook exist (`src/routes/api/user/delete/+server.ts`, `docs/runbooks/ACCOUNT_DELETION_PROCEDURE.md`).
  - Gmail token encryption key rotation runbook exists (`docs/runbooks/GMAIL_TOKEN_ENCRYPTION_KEY_ROTATION.md`).

## SOC 2 readiness checklist (practical)

Typical SOC 2 evidence you’ll need (beyond code):
- **Policies**: security, access control, change management, incident response, vendor management, data retention/deletion.
- **Access reviews**: periodic review of GCP IAM, Firebase roles, GitHub access.
- **Logging/monitoring**: Cloud Audit Logs enabled, alerting on auth/admin changes and service errors.
- **Vulnerability management**: dependency scanning cadence, patch SLAs, container scanning.
- **Backups/DR**: Firestore/Storage backup approach, recovery testing, RTO/RPO definitions.

## Suggested next steps (high-level)

1) Remove committed PII/artifacts + scrub history if needed.
2) Add CI pipelines: tests, lint, dependency scanning, secrets scanning.
3) Tighten IAM: dedicated runtime identities, scope Secret Manager access, separate dev/prod projects.
4) Harden endpoints: consistent CSRF checks, email header sanitization, rate limiting where relevant.
5) Update Privacy Policy to meet Google OAuth Limited Use and align to actual data practices.
