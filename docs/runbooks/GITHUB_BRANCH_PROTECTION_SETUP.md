# GitHub Branch Protection Setup (SOC 2 / CASA Evidence)

This runbook configures **required checks + review gates** so your repo produces consistent change-management evidence.

## Target

- Repository: `penni-ai/penni-ai-platform`
- Protected branch: `main`

## 1) Create a branch protection rule

GitHub: **Settings → Branches → Branch protection rules → Add rule**

- Branch name pattern: `main`
- Enable:
  - **Require a pull request before merging**
  - **Require approvals**: 1 (or 2 for security-sensitive changes)
  - **Dismiss stale approvals when new commits are pushed**
  - **Require conversation resolution before merging**
  - **Require status checks to pass before merging**
    - Select these checks (names may vary slightly based on GitHub UI):
      - `CI / app`
      - `CI / pipeline-service`
      - `Security / gitleaks`
      - `Security / npm-audit`
  - **Do not allow bypassing the above settings**

Optional (recommended):
- **Require linear history**
- **Require signed commits** (only if your team already signs commits)

## 2) Validate

1. Open a PR and confirm required checks appear and must pass.
2. Confirm the merge button is blocked until:
   - at least one approval, and
   - all required checks pass.

## 3) Evidence to save

- Screenshot of the `main` branch rule settings page.
- A PR showing:
  - passing `CI` and `Security` checks, and
  - reviewer approval before merge.

