# Incident Response Runbook (Lightweight)

This runbook defines a minimal incident response process suitable for early-stage SOC 2 / CASA readiness.

## Severity levels

- **SEV1**: Active compromise, widespread outage, or sensitive data exposure.
- **SEV2**: Partial outage, elevated error rates, limited customer impact.
- **SEV3**: Minor issue, no customer impact, or near-miss.

## Immediate actions (SEV1/SEV2)

1. Declare incident and assign an incident commander.
2. Contain the issue:
   - Disable/rotate impacted secrets.
   - Revoke compromised tokens.
   - Restrict IAM / disable accounts if needed.
3. Preserve evidence:
   - Export relevant Cloud Logging entries.
   - Snapshot IAM policy (project + secret IAM).
4. Eradicate and recover:
   - Patch and deploy fixes.
   - Validate service health and customer flows.
5. Communicate:
   - Internal updates at a fixed cadence.
   - Customer updates if required (scope + impact + mitigation).

## Post-incident

- Write a postmortem (timeline, root cause, corrective actions).
- Track follow-ups to completion and verify effectiveness.

