# Change Management Policy

## Goals

- Reduce production risk and create audit evidence of controlled changes.

## Requirements for production changes

- All changes go through a pull request.
- At least one reviewer approval (two for security-sensitive areas if possible).
- CI must pass:
  - Unit tests
  - Typecheck
  - Secrets scanning
- Deployments must be traceable to a commit SHA.

## Emergency changes

- Allowed when required to mitigate active incidents.
- Must be followed by a retroactive PR and postmortem with corrective actions.

## Evidence

- GitHub PR history (reviews + checks).
- CI logs and deployment logs (Cloud Build/Run revisions).

