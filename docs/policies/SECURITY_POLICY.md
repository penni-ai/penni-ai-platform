# Security Policy (Baseline)

This document describes the baseline security expectations for Penny Platform. It is intended to support SOC 2 / CASA readiness and internal operations.

## Scope

- Production GCP project(s) and Firebase/App Hosting deployments.
- Application code in this repository (web app + `services/pipeline-service`).
- Customer data stored in Firestore and Cloud Storage.

## Principles

- Least privilege by default (IAM, app permissions, OAuth scopes).
- Defense-in-depth (authn/authz, request integrity, secrets handling, logging hygiene).
- Treat tokens, secrets, and message content as sensitive.
- Prefer automation and auditability (CI, logs, backups, access reviews).

## Responsibilities

- Engineering: implements controls, reviews changes, responds to incidents.
- Security owner (designated): approves risk exceptions, performs access reviews, maintains this policy.

## Required controls (minimum)

- **Identity & access**: MFA for administrators; periodic access reviews; remove access promptly on offboarding.
- **Secrets**: store in Secret Manager; do not commit to git; rotate on compromise; use per-secret IAM.
- **Key rotation**: rotate encryption keys using documented runbooks (e.g., `docs/runbooks/GMAIL_TOKEN_ENCRYPTION_KEY_ROTATION.md`) and retain evidence.
- **Logging**: structured logs; redact tokens and email/message content; retain logs per retention policy.
- **Backups**: managed backups enabled; restore procedure tested and evidenced.
- **Change management**: PR reviews + CI checks required for production changes.
- **Vulnerability management**: dependency updates, scanning, and patch SLAs for high/critical issues.

## Exceptions

Any exception to this policy must be documented with:
- owner, scope, risk, compensating controls, and an expiration date.
