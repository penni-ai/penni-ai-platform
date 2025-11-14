# Search Endpoint 500 Error - Analysis & Fix Plan

## Current Approach Summary

### Flow:
1. **Client** → POST `/api/search/influencers` with `business_description`, `top_n`, etc.
2. **API Endpoint** (`src/routes/api/search/influencers/+server.ts`):
   - Validates input (business_description, top_n, follower counts)
   - Checks user authentication (`requireUser`)
   - Checks search usage limit (`getSearchUsage`)
   - Mints Firebase ID token (`mintIdToken`)
   - Calls Cloud Function `pipelineInfluencerAnalysis` via HTTP
   - Binds `pipeline_id` to campaign (if provided)
   - Increments search usage (`incrementSearchUsage`)
   - Returns response

### Potential Failure Points:

1. **`getSearchUsage()`** - Firestore read might fail
   - Reads `users/{uid}/usage/searches` document
   - Reads `users/{uid}` document for plan info
   - **Issue**: Firestore rules might block this (but we fixed rules, so should be OK)

2. **`mintIdToken()`** - Token exchange might fail
   - Creates custom token via Admin SDK
   - Exchanges for ID token via Firebase Auth API
   - **Issue**: `PUBLIC_FIREBASE_API_KEY` might be missing or invalid

3. **Cloud Function Call** - Function might not exist or be unreachable
   - Function name: `pipelineInfluencerAnalysis`
   - URL: `https://{region}-{project}.cloudfunctions.net/pipelineInfluencerAnalysis`
   - **Issue**: Function might not be deployed, URL wrong, or function throws error

4. **`incrementSearchUsage()`** - Firestore write might fail
   - Writes to `users/{uid}/usage/searches`
   - **Issue**: Firestore rules might block write (but we allow writes to usage)

5. **`bindCampaignPipelineId()`** - Transaction might fail
   - Updates `users/{uid}/campaigns/{campaignId}` with `pipeline_id`
   - **Issue**: Firestore rules should allow this (we fixed rules)

## New Approach: Enhanced Error Handling & Debugging

### Problem:
- 500 error doesn't tell us WHERE it's failing
- Error details are logged but not visible to client
- No way to distinguish between different failure types

### Solution:

1. **Add detailed error logging at each step**
   - Log before/after each critical operation
   - Include request context (uid, requestId, etc.)

2. **Improve error messages**
   - Return more specific error codes
   - Include operation context in error details

3. **Add validation checks**
   - Verify function URL is correct
   - Verify function exists before calling
   - Check environment variables are set

4. **Graceful degradation**
   - Don't fail entire request if non-critical operations fail
   - Continue even if campaign binding fails (log warning)

5. **Better error propagation**
   - Wrap errors with context
   - Preserve original error messages

## Implementation Plan

### Step 1: Add comprehensive logging
- Log at each step with context
- Include function URL, request body, response status

### Step 2: Improve error handling
- Catch errors at each step
- Wrap with context
- Return specific error codes

### Step 3: Add validation
- Check function URL construction
- Verify required env vars
- Validate function response format

### Step 4: Make non-critical operations optional
- Campaign binding failure shouldn't fail entire request
- Usage increment failure should be logged but not fail request

