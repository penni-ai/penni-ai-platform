# SOC 2 + CASA (Tier 2) Remediation Plan (Prioritized)

This plan is organized by **risk + audit impact**, not by engineering convenience.

## Phase 0 — Stop-the-bleeding (1–3 days)

1. **Remove committed PII/data artifacts from Git** (done on `casa-readiness`)
   - Decide whether to scrub git history (recommended if any real customer data exists).
2. **Prevent accidental deploy of data artifacts** (done on `casa-readiness`)
   - `.gitignore` now prevents reintroduction; keep CI scanning as the backstop.
3. **Add CI "minimum bar"** (partially done in-repo)
   - Added GitHub Actions workflows for unit tests + typecheck and gitleaks scanning (`.github/workflows/ci.yml`, `.github/workflows/security.yml`).
   - Still needed: enforce required checks via GitHub branch protection.
4. **Fix pipeline job authorization (critical)** (done on `casa-readiness`)
   - `pipeline_jobs/{pipelineId}.uid` is now the source-of-truth; missing/mismatch returns `404 PIPELINE_NOT_FOUND` to avoid cross-tenant enumeration.
   - Removed the unsafe "campaign fallback" ownership logic and verbose debug logging from `src/routes/api/pipeline/[pipelineId]/+server.ts`.
5. **Restrict public test/debug endpoints** (done on `casa-readiness`)
   - `src/routes/api/public/test-search/+server.ts` is now blocked unless running in emulator mode or `E2E_TESTING=true`.
6. **Harden state-changing endpoints** (done on `casa-readiness`)
   - `assertSameOrigin()` applied across cookie-authenticated state-changing endpoints; webhook endpoints rely on signature/auth instead.
   - Added account deletion request endpoint (`src/routes/api/user/delete/+server.ts`) to support retention/deletion posture.
7. **Fix email header injection** (done on `casa-readiness`)
   - CR/LF stripping + input sanitization added for Gmail sending in both app and pipeline-service.
8. **Fix high-risk GCP config (minimum viable hardening)** (partially done in GCP `penni-ai-platform`)
   - Done: Removed project-level `roles/iam.serviceAccountTokenCreator` from `firebase-app-hosting-compute@...` (kept self-binding only).
   - Done: Removed project-level `roles/iam.serviceAccountTokenCreator` from `firebase-adminsdk-...` (kept self-binding only).
   - Done: Removed unused default network firewall rules (`default-allow-ssh`, `default-allow-rdp`, `default-allow-icmp`).
   - Done: Scoped Secret Manager access to per-secret IAM (removed project-wide `secretAccessor`).
   - Done: Enabled audit logging posture (`auditConfigs`) for Secret Manager data access + Datastore writes.
   - Done: Configured Firestore managed backups schedule (daily, 30d retention).
   - Done: Increased application log retention (`_Default` bucket, global) to 90 days.
   - Done: Enforced Cloud Storage Public Access Prevention on the Firebase Storage bucket (`public_access_prevention=enforced`).
   - Done: Restore test runbook added (`docs/runbooks/FIRESTORE_BACKUP_RESTORE_TEST.md`).
   - Still needed: Perform at least one restore test and capture evidence.

### GCP quick-fix commands (do intentionally)

These are high-impact production changes; run them after confirming expected behavior and rollback options.

- **Remove project-level Token Creator from App Hosting runtime identity** (keep self-binding only):
  - `gcloud projects remove-iam-policy-binding penni-ai-platform --member="serviceAccount:firebase-app-hosting-compute@penni-ai-platform.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --condition=None`
- **Remove project-level Token Creator from firebase-adminsdk identity** (keep self-binding only):
  - `gcloud projects remove-iam-policy-binding penni-ai-platform --member="serviceAccount:firebase-adminsdk-fbsvc@penni-ai-platform.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --condition=None`
- **Delete unused default network firewall rules (no VMs exist in this project)**:
  - `gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp default-allow-icmp`
- **Create Firestore managed backups** (example: daily, retain 30 days):
  - `gcloud firestore backups schedules create --database='(default)' --retention=30d --recurrence=daily`
- **Increase app log retention** (example: 90 days for `_Default` bucket):
  - `gcloud logging buckets update _Default --location=global --retention-days=90`
- **Enforce Cloud Storage Public Access Prevention** (prevents accidental public exposure):
  - `gcloud storage buckets update gs://penni-ai-platform.firebasestorage.app --public-access-prevention`

## Phase 1 — SOC 2 baseline controls (1–2 weeks)

1. **IAM least privilege + service accounts**
   - Dedicated runtime SAs: App Hosting backend, pipeline service.
   - Secret-level IAM for Secret Manager.
2. **Centralize config + secret naming**
   - Normalize Gmail OAuth env var names across services (avoid `GOOGLE_CLIENT_*` vs `GMAIL_OAUTH_*` drift).
3. **Logging + redaction** (mostly done on `casa-readiness`)
   - Key-based + token-pattern redaction added; keep expanding coverage and add a “no PII in logs” policy.
   - Remove server-side debug logs that include user IDs, emails, pipeline IDs, or other identifiers unless necessary (hash/domain only).
4. **Monitoring/alerting**
   - Define SLOs and alerts for Cloud Run/Functions errors, elevated auth failures, and IAM policy changes.
5. **Vulnerability management**
   - Dependency scanning and patch cadence.
   - Container image scanning (Artifact Registry + vulnerability scanning).

Status (implemented on `casa-readiness`):
- IAM: removed unused Pub/Sub resources + roles, moved App Hosting storage access to bucket-level, kept Cloud Run services non-public where intended.
- Config naming: standardized Gmail OAuth + token encryption env vars (`GMAIL_OAUTH_*`, `GMAIL_TOKEN_ENCRYPTION_KEY*`).
- Logging: secret/PII redaction in app + pipeline-service; removed API key “masking” logs.
- Monitoring: alert policies for Cloud Run 5xx, Cloud Scheduler failures, and IAM `SetIamPolicy` changes.
- Vulnerability management: `npm audit` baseline in CI; enabled Artifact Registry vulnerability scanning and created `pipeline-service-images` repo for scanned pipeline-service builds.

## Phase 2 — CASA (Tier 2) package completion (1–3 weeks, parallelizable)

1. **Privacy Policy + disclosures**
   - Add explicit Google API Services User Data Policy + Limited Use language.
   - Ensure accuracy (e.g., password handling if using Firebase Auth).
2. **OAuth consent screen readiness**
   - Domain verification, authorized redirect URIs, scope justification.
3. **Reviewer artifacts**
   - Video walkthrough, test user flow, support contact, data deletion explanation.

## Phase 3 — Audit readiness and evidence (2–6 weeks)

1. **Formal policies** (drafted in-repo)
   - Baseline policy drafts added under `docs/policies/` (security, access control, incident response, change management, vendor management, data retention/deletion).
   - Still needed: assign owners, finalize language, and adopt a review cadence.
2. **Access review process**
   - Monthly review of GCP IAM + Firebase project roles + GitHub access.
3. **Backups/DR**
   - Document Firestore/Storage backup and run at least one restore test with evidence.
4. **Onboarding/offboarding**
   - Document and track access provisioning/deprovisioning.
