# Authentication Approach Analysis: User ID Token vs Service Account

## Current Issue

**Error**: 401 Unauthorized when calling `/api/search/influencers`

**Current Flow**:
1. User makes request to App Hosting API endpoint
2. App Hosting endpoint mints custom token for user → exchanges for ID token
3. App Hosting calls Cloud Function with user's ID token in `Authorization: Bearer <idToken>` header
4. Cloud Function verifies ID token and extracts user UID
5. **Problem**: Function returns 401 Unauthorized

## Two Authentication Approaches

### Option 1: User ID Token (Current Approach)

**How it works**:
- App Hosting creates custom token for user via Admin SDK
- Exchanges custom token for Firebase Auth ID token
- Sends ID token in `Authorization: Bearer <idToken>` header
- Cloud Function verifies ID token using `auth.verifyIdToken(idToken)`
- Function extracts `decoded.uid` from verified token

**Pros**:
- ✅ **Secure**: User identity is cryptographically verified
- ✅ **User-level permissions**: Function knows exactly which user made the request
- ✅ **Audit trail**: Can track which user initiated each pipeline
- ✅ **Prevents spoofing**: User can't fake their identity in request body

**Cons**:
- ❌ **Complex**: Requires custom token creation permission
- ❌ **More IAM setup**: Need `iam.serviceAccounts.signBlob` permission
- ❌ **Token exchange overhead**: Extra API call to Firebase Auth

**Current Status**: 
- ✅ Custom token creation permission granted
- ✅ Function invocation permission granted
- ❌ Still getting 401 - likely token verification issue

### Option 2: Service Account Authentication

**How it works**:
- App Hosting uses its own service account identity
- Cloud Function trusts App Hosting service account
- User ID passed in request body (not verified)
- Function extracts user ID from `request.body.uid`

**Pros**:
- ✅ **Simple**: No custom token creation needed
- ✅ **Faster**: No token exchange overhead
- ✅ **Less IAM complexity**: Only need function invocation permission

**Cons**:
- ❌ **Less secure**: User ID comes from request body (could be spoofed)
- ❌ **No user verification**: Function can't verify user identity
- ❌ **Trust boundary**: Must trust App Hosting to correctly pass user ID
- ❌ **Less auditability**: Harder to verify which user actually made request

## Root Cause Analysis

### Why 401 is Still Happening

The function has `invoker: 'private'` which means:
1. **IAM check**: Caller must have `roles/run.invoker` permission ✅ (we granted this)
2. **Function-level auth**: Function code verifies ID token ❌ (this is failing)

**Possible Issues**:
1. **ID token not being sent correctly**: Header format might be wrong
2. **ID token verification failing**: Token might be invalid/expired
3. **Function expecting different auth**: Function might need service account token instead
4. **Token scope issue**: ID token might not have right audience/claims

### Current Function Code Expects:
```typescript
const idToken = extractBearerToken(authHeader);
const decoded = await auth.verifyIdToken(idToken); // This might be failing
```

## Recommended Approach: Hybrid (Best of Both)

**Use User ID Token BUT with better error handling**:

1. **Keep current approach** (user ID token) - it's more secure
2. **Add better logging** to see why token verification fails
3. **Add fallback** if token verification fails (log error, return helpful message)
4. **Verify token is being sent correctly** (log token presence, not content)

## Implementation Plan

### Step 1: Debug Current Issue
- Add logging in function to see if token is received
- Log token verification errors with details
- Check if token format is correct

### Step 2: Fix Token Verification
- Ensure ID token has correct audience
- Verify token isn't expired
- Check if token is being sent in correct header format

### Step 3: Add Fallback (if needed)
- If user ID token approach proves too complex, switch to service account
- But add request validation to ensure user ID matches authenticated user

## Decision Matrix

| Factor | User ID Token | Service Account |
|--------|---------------|-----------------|
| Security | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Complexity | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Performance | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Auditability | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Recommendation** | **✅ Use this** | Use only if user token fails |

## Next Steps

1. **Debug why token verification is failing** - add logging to function
2. **Verify token is being sent correctly** - check headers in API endpoint
3. **Check token audience/claims** - ensure token is valid for this project
4. **If still failing**: Consider switching to service account auth with request validation

