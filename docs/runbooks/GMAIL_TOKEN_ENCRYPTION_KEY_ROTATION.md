# Gmail Token Encryption Key Rotation (Runbook)

This runbook describes how to rotate the Gmail token encryption key used to encrypt stored OAuth tokens (AES-256-GCM).

## Overview

- **Primary key**: `GMAIL_TOKEN_ENCRYPTION_KEY` (base64-encoded 32 bytes)
- **Previous key (temporary)**: `GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS` (base64-encoded 32 bytes)
- **Encryption behavior**: new tokens are encrypted with the primary key.
- **Decryption behavior**: the app tries the primary key, then (if set) the previous key.

This enables a safe rotation window where both keys are available, followed by a migration that re-encrypts existing tokens with the new primary key.

## Step 1 — Generate a new key

- `openssl rand -base64 32`

Store the new key in Secret Manager as the next value for `GMAIL_TOKEN_ENCRYPTION_KEY`.

## Step 2 — Deploy with dual-key decryption

1. Keep the **old key** available as `GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS`.
2. Set `GMAIL_TOKEN_ENCRYPTION_KEY` to the **new key**.
3. Deploy both the App Hosting backend and `pipeline-service`.

At this point, existing connections continue to work (old tokens can be decrypted via the previous key), and new/updated tokens are encrypted with the new key.

## Step 3 — Re-encrypt stored tokens

Run the migration script (dry-run first):

- `GMAIL_TOKEN_ENCRYPTION_KEY=... GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS=... tsx scripts/rotate-gmail-token-encryption-key.ts --dry-run`

Then apply:

- `GMAIL_TOKEN_ENCRYPTION_KEY=... GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS=... tsx scripts/rotate-gmail-token-encryption-key.ts`

Optional scope controls:

- `--uid <uid>` to rotate a single user.
- `--batch-size <n>` / `--max-docs <n>` to limit impact.

## Step 4 — Remove the previous key

After the migration completes and you’ve validated Gmail sending/drafting works:

1. Remove `GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS` from runtime configuration.
2. Deploy again.
3. Retire the old key per your key lifecycle policy.

## Evidence (SOC2/CASA)

- Change record for the rotation (who/when/why).
- Script output summary (counts only; do not capture token values).
- Post-rotation validation (connect Gmail, send draft, disconnect).

