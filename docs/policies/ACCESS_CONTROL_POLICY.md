# Access Control Policy

## Goals

- Ensure only authorized personnel and workloads can access systems and data.
- Enforce least privilege and provide audit evidence of access reviews.

## Human access

- Use individual accounts (no shared logins).
- Require MFA for all admin access (GCP, Firebase, GitHub).
- Grant access via groups/roles where possible; avoid direct bindings.
- Perform access reviews at least monthly (GCP IAM, Firebase roles, GitHub org/repo access).

## Workload access (service accounts)

- Use dedicated service accounts per workload (App Hosting backend, pipeline service).
- Prefer **per-secret IAM** over project-wide `roles/secretmanager.secretAccessor`.
- Avoid user-managed service account keys; use workload identity / ADC.
- Restrict Cloud Run ingress and invokers (no public invocation unless explicitly required).

## Authentication and session security

- Use secure, httpOnly session cookies.
- Require origin checks (CSRF mitigation) for all cookie-authenticated state changes.
- Log auth failures and monitor for anomalies.

## Evidence

- IAM exports (project IAM + secret IAM) and monthly review signoff.
- Records of access provisioning/deprovisioning.

