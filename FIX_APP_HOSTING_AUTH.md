# Fix: App Hosting Custom Token Creation Permission

## Problem
App Hosting service account doesn't have permission to create custom tokens:
```
Permission 'iam.serviceAccounts.signBlob' denied on resource
```

## Root Cause
The `mintIdToken()` function uses `adminAuth.createCustomToken()` which requires the `iam.serviceAccounts.signBlob` permission. App Hosting's service account doesn't have this permission by default.

## Solution

Grant the App Hosting service account permission to impersonate the Firebase App Engine service account (which has permission to create custom tokens).

### Step 1: Get App Hosting Service Account Email

```bash
gcloud iam service-accounts list \
  --project=penni-ai-platform \
  --filter="displayName:App Hosting" \
  --format="value(email)"
```

Or find it in Firebase Console: App Hosting → Settings → Service Account

### Step 2: Grant Permission

Grant the App Hosting service account the `roles/iam.serviceAccountTokenCreator` role on the Firebase App Engine service account:

```bash
# Get the App Engine service account (default Firebase Admin SDK service account)
APP_ENGINE_SA="${PROJECT_ID}@appspot.gserviceaccount.com"

# Get App Hosting service account email (from Step 1)
APP_HOSTING_SA="<app-hosting-service-account-email>"

# Grant permission
gcloud iam service-accounts add-iam-policy-binding \
  "${APP_ENGINE_SA}" \
  --member="serviceAccount:${APP_HOSTING_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=penni-ai-platform
```

### Alternative: Use Project-Level Role

If the above doesn't work, grant the role at the project level:

```bash
gcloud projects add-iam-policy-binding penni-ai-platform \
  --member="serviceAccount:${APP_HOSTING_SA}" \
  --role="roles/iam.serviceAccountTokenCreator"
```

## Verification

After granting permissions, test the search endpoint again. The error should be resolved.

## Notes

- This permission allows App Hosting to create custom tokens on behalf of users
- The custom tokens are then exchanged for ID tokens via Firebase Auth API
- This is the standard way to authenticate server-to-server calls to Cloud Functions that require user identity

