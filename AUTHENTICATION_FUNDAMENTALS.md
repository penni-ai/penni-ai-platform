# Authentication Fundamentals: Client → Server → Cloud Function

## 🎯 Quick Summary

**The Problem**: Cloud Run (hosting your Cloud Function) is rejecting requests with 401 Unauthorized because:
- Function has `invoker: 'private'` (requires authentication)
- We're sending a **user ID token** in Authorization header
- Cloud Run expects a **service account token** for the IAM check
- Request is rejected BEFORE it reaches your function code

**The Solution**: Use service account authentication (simpler and more reliable):
- Remove user ID token from Authorization header
- Let GCP use service account token automatically (already configured)
- Pass user ID in request body
- Function validates user ID (format, existence)

**Key Insight**: There are TWO layers of authentication:
1. **IAM Layer** (infrastructure): "Can App Hosting call this function?" → Uses service account
2. **Application Layer** (your code): "Which user made this request?" → Uses user ID from body

## 🏗️ Architecture Overview

```
┌─────────┐         ┌──────────────────┐         ┌──────────────────┐
│ Client  │ ──────> │  App Hosting     │ ──────> │  Cloud Function  │
│ Browser │         │  (SvelteKit API) │         │  (pipelineInfluencerAnalysis) │
└─────────┘         └──────────────────┘         └──────────────────┘
   User Auth          Server-side API              Background Job
   (Firebase)         (Node.js/SvelteKit)          (Cloud Functions)
```

### Key Components

1. **Client (Browser)**: User's browser, authenticated via Firebase Auth
2. **App Hosting Server**: Your SvelteKit API routes running on Firebase App Hosting
3. **Cloud Function**: Background job processor (influencer search pipeline)

## 🔐 Two Layers of Authentication

Think of it like a building with two security checkpoints:

### Layer 1: IAM (Infrastructure-Level) Authentication
**Purpose**: "Who is calling this service?" (Building security guard)
- **Where**: Google Cloud Platform (GCP) infrastructure level
- **What it checks**: Service account identity
- **Token type**: Service account token (automatically added by GCP)
- **Example**: "Is `firebase-app-hosting-compute@...` allowed to call this function?"
- **When**: Happens BEFORE your function code runs
- **Who checks**: Cloud Run (the infrastructure hosting your function)

**Analogy**: Like showing your employee badge to get into the building

### Layer 2: Application-Level Authentication  
**Purpose**: "Which user is making this request?" (Office security)
- **Where**: Inside your function code
- **What it checks**: User identity (Firebase Auth)
- **Token type**: Firebase ID token (user's identity)
- **Example**: "Is user `MJXv4Rh5RnaEWtUqOQwfvUDNLWf1` authenticated?"
- **When**: Happens AFTER Layer 1 passes
- **Who checks**: Your function code

**Analogy**: Like showing your ID to access a specific room

### The Problem

**Current situation**: Layer 1 is failing because Cloud Run sees a USER ID token in the Authorization header, but it might be expecting a SERVICE ACCOUNT token for the IAM check.

**Why this happens**: 
- `invoker: 'private'` means Cloud Run does extra checks
- Cloud Run checks the Authorization header
- We're sending a user ID token (for Layer 2)
- But Cloud Run might need a service account token for Layer 1

## 📊 Current Flow (What We're Trying to Do)

### Step-by-Step Breakdown

```
1. CLIENT (Browser)
   └─> User clicks "Search Influencers"
   └─> Browser sends: POST /api/search/influencers
   └─> Includes: Firebase Auth session cookie/token (user is logged in)

2. APP HOSTING SERVER (SvelteKit API Route)
   │
   ├─> hooks.server.ts (runs BEFORE your route handler)
   │   ├─> Gets session cookie from request
   │   ├─> Verifies session cookie: adminAuth.verifySessionCookie(sessionCookie)
   │   ├─> ✅ USER IS VERIFIED HERE (cryptographically verified)
   │   └─> Sets: event.locals.user = { uid: "...", email: "...", ... }
   │
   ├─> Your API Route Handler
   │   ├─> requireUser() checks: Does event.locals.user exist?
   │   ├─> Gets user.uid = "MJXv4Rh5RnaEWtUqOQwfvUDNLWf1" (already verified!)
   │   │
   │   ├─> STEP A: Mint Custom Token
   │   │   └─> Calls: adminAuth.createCustomToken(user.uid)
   │   │   └─> Purpose: Create a token FOR the already-verified user
   │   │   └─> Does NOT verify UID - assumes it's valid (already verified above)
   │   │   └─> Returns: Custom token (signed by Firebase Admin SDK)
   │   │   └─> Requires: iam.serviceAccounts.signBlob permission ✅ (we fixed this)
   │   │
   │   ├─> STEP B: Exchange for ID Token
   │   │   └─> Calls: Firebase Auth API
   │   │   └─> Sends: Custom token
   │   │   └─> Returns: ID token (contains user.uid, cryptographically signed)
   │   │   └─> Purpose: Create a token the Cloud Function can independently verify
   │   │
   │   └─> STEP C: Call Cloud Function
   │       └─> URL: https://us-central1-penni-ai-platform.cloudfunctions.net/pipelineInfluencerAnalysis
   │       └─> Headers: Authorization: Bearer <USER_ID_TOKEN>
   │       └─> Body: { business_description: "...", uid: "MJXv4Rh5RnaEWtUqOQwfvUDNLWf1", ... }

3. CLOUD FUNCTION (pipelineInfluencerAnalysis)
   │
   ├─> 🚪 LAYER 1 CHECK: IAM Authentication (GCP Infrastructure)
   │   │
   │   ├─> Cloud Run intercepts request BEFORE function code runs
   │   ├─> Checks: "Who is calling this function?"
   │   │
   │   ├─> Automatic check: Service account token (from App Hosting)
   │   │   └─> ✅ App Hosting SA has roles/run.invoker? YES (we granted this)
   │   │
   │   ├─> Additional check: Authorization header (because invoker: 'private')
   │   │   └─> Sees: Authorization: Bearer <USER_ID_TOKEN>
   │   │   └─> Problem: Cloud Run might expect SERVICE ACCOUNT token here
   │   │   └─> ❌ Rejects with HTML 401 Unauthorized
   │   │
   │   └─> Request NEVER reaches function code!
   │
   └─> 🚪 LAYER 2 CHECK: Application Authentication (Function Code)
       └─> Function code: auth.verifyIdToken(idToken)
       └─> Verifies: User ID token is valid
       └─> Extracts: decoded.uid = "MJXv4Rh5RnaEWtUqOQwfvUDNLWf1"
       └─> ❌ Never reaches here because Layer 1 fails!
```

## 🚨 The Problem: Token Mismatch

### What's Happening

When `invoker: 'private'` is set, Cloud Functions v2 (which uses Cloud Run) does TWO checks:

1. **IAM Check** (Infrastructure):
   - Checks the **service account** making the call
   - Uses the **service account token** (automatically added by GCP)
   - ✅ This passes (we granted `roles/run.invoker`)

2. **Authorization Header Check** (Infrastructure):
   - For `invoker: 'private'`, Cloud Run ALSO checks the `Authorization` header
   - It expects a **service account token** OR **valid ID token**
   - ❌ We're sending a **user ID token**, but Cloud Run might be rejecting it

### Why User ID Tokens Might Fail

User ID tokens are designed for:
- Client → Server communication
- Server → Server communication (if the server is trusted)

But Cloud Run's `invoker: 'private'` might expect:
- Service account tokens for infrastructure-level auth
- OR it might need special configuration to accept user ID tokens

## 🔑 Token Types Explained

### 1. Service Account Token (GCP IAM)
```
What: Represents a service account's identity
Who: App Hosting service account
Purpose: "I am firebase-app-hosting-compute@..."
How: Automatically added by GCP when App Hosting calls Cloud Function
Used for: IAM-level permissions (can this service call this function?)
```

### 2. Custom Token (Firebase Admin SDK)
```
What: Temporary token that can be exchanged for an ID token
Who: Created by Firebase Admin SDK for a specific user
Purpose: "I am authorized to get an ID token for user X"
How: adminAuth.createCustomToken(uid)
Used for: Exchanging for ID token
```

### 3. ID Token (Firebase Auth)
```
What: Represents a user's authenticated identity
Who: The actual user (e.g., "MJXv4Rh5RnaEWtUqOQwfvUDNLWf1")
Purpose: "I am user X, and I'm authenticated"
How: Exchange custom token via Firebase Auth API
Used for: Application-level authentication (which user made this request?)
```

## 💡 Two Solutions

### Solution 1: Use Service Account Authentication (Recommended)

**How it works**:
```
Client → App Hosting API → Cloud Function
         (user authenticated)    (service account auth)
```

**Changes needed**:
1. Remove user ID token from Authorization header
2. Let GCP use service account token automatically
3. Pass user ID in request body
4. Function validates user ID (format, existence)

**Pros**:
- ✅ Simpler (no custom token creation)
- ✅ Works with `invoker: 'private'`
- ✅ Faster (no token exchange)
- ✅ Still secure (only App Hosting can call function)

**Cons**:
- ⚠️ User ID comes from request body (but App Hosting validates it first)

### Solution 2: Make Function Public + User Token

**How it works**:
```
Client → App Hosting API → Cloud Function
         (user authenticated)    (user ID token)
```

**Changes needed**:
1. Change `invoker: 'private'` to `invoker: 'public'`
2. Function verifies user ID token
3. Only authenticated users can call (function-level check)

**Pros**:
- ✅ User identity cryptographically verified
- ✅ No service account permission needed

**Cons**:
- ⚠️ Function is publicly accessible (anyone can try to call it)
- ⚠️ Function must handle authentication itself
- ⚠️ More attack surface

## 🎯 Recommended Approach: Service Account + User ID Validation

### Why This Works Best

1. **Security**: Function is private (only App Hosting can call)
2. **Simplicity**: No custom token creation needed
3. **Performance**: Faster (no token exchange)
4. **Reliability**: Works with Cloud Run's IAM model

### Implementation

```typescript
// In App Hosting API endpoint
const functionResponse = await fetch(functionUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // NO Authorization header - GCP uses service account token automatically
  },
  body: JSON.stringify({
    uid: user.uid, // User ID from authenticated session
    business_description: "...",
    // ... other params
  })
});

// In Cloud Function
export const pipelineInfluencerAnalysis = onRequest(
  { invoker: 'private' }, // Only App Hosting can call
  async (request, response) => {
    // Get user ID from request body (validated by App Hosting)
    const uid = request.body?.uid;
    if (!uid || typeof uid !== 'string') {
      return response.status(400).json({ error: 'Missing uid' });
    }
    
    // Validate user exists (optional but recommended)
    const userRecord = await auth.getUser(uid);
    
    // Process request...
  }
);
```

## 🔍 Why We're Getting 401

The HTML 401 error suggests Cloud Run is rejecting the request **before** it reaches your function code. This happens because:

1. Function has `invoker: 'private'` → Cloud Run does extra security checks
2. Cloud Run checks Authorization header → Sees user ID token
3. Cloud Run expects service account token → For IAM-level authentication
4. Mismatch → User ID token ≠ Service account token
5. Request rejected → HTML 401 page (not JSON, because function code never runs)

### Visual Flow of What's Happening

```
Request arrives at Cloud Run
    ↓
[Layer 1: IAM Check]
    ├─> Service account token? ✅ (automatic, from App Hosting)
    ├─> Has roles/run.invoker? ✅ (we granted this)
    ├─> Authorization header check? ❌ (sees user ID token, expects SA token)
    └─> REJECTED → HTML 401
    ↓
[Layer 2: Function Code] ← NEVER REACHES HERE
    └─> Would verify user ID token
    └─> Would extract user.uid
    └─> Would process request
```

### What Should Happen (Service Account Auth)

```
Request arrives at Cloud Run
    ↓
[Layer 1: IAM Check]
    ├─> Service account token? ✅ (automatic, from App Hosting)
    ├─> Has roles/run.invoker? ✅ (we granted this)
    ├─> Authorization header? ✅ (no header needed, or SA token)
    └─> PASSED → Request forwarded to function
    ↓
[Layer 2: Function Code]
    ├─> Gets user ID from request.body.uid
    ├─> Validates user ID format
    ├─> Optionally: Verifies user exists in Firestore
    └─> Processes request ✅
```

## ✅ The Fix

**Switch to service account authentication**:
- Remove user ID token from Authorization header
- Let GCP use service account token automatically
- Pass user ID in request body (already verified by App Hosting)
- Function validates user ID format/existence

This works because:
- ✅ IAM check passes (service account has permission)
- ✅ Function receives request
- ✅ User ID is already verified (by App Hosting's session cookie verification)
- ✅ Simpler and more reliable

### Key Insight: Steps A & B Are Redundant!

**What Steps A & B Actually Do**:
- Step A: Creates a custom token FOR an already-verified user
- Step B: Exchanges it for an ID token
- **Purpose**: Let Cloud Function independently verify user identity

**But We Don't Need This Because**:
- User is ALREADY verified in `hooks.server.ts` (session cookie verification)
- App Hosting is trusted (only it can call the function via IAM)
- We can just pass the UID directly - it's already verified!

**The Real Flow Should Be**:
```
hooks.server.ts → Verifies user (session cookie) ✅
    ↓
API Route → Gets user.uid (already verified)
    ↓
Call Cloud Function → Pass user.uid in body
    ↓
Cloud Function → Validates UID format/existence
    ↓
Process request ✅
```

No token exchange needed! The user is already verified.

