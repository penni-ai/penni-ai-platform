# Deployment Guide – Creator Search Pipeline

## 1. Overview
This document explains how to deploy the Python Cloud Functions that power the creator discovery pipeline. The pipeline now pulls creator results directly from Weaviate (hybrid search + DeepInfra embeddings/reranker), eliminating the old LanceDB snapshot download. Cold starts are effectively instant: each instance instantiates the Weaviate client plus HTTP helpers, then chains reranking, BrightData enrichment, and LLM-based fit scoring.

## 2. Prerequisites
- Firebase project with Cloud Functions v2 enabled.
- Weaviate cluster URL + API key (and collection name).
- BrightData dataset IDs (Instagram and/or TikTok) if the enrichment stage is enabled.
- OpenAI + DeepInfra API keys for query expansion, embeddings, and reranker stages.
- Firebase CLI (`firebase-tools`), Python 3.13, and `pip`.

```bash
cd functions
pip install -r requirements.txt
```

## 3. Configure Environment Variables
Set non-secret parameters via the Firebase CLI (or your preferred config mechanism). The key variables are the Weaviate settings plus BrightData tuning knobs.

```bash
firebase functions:config:set \
  weaviate.url="https://your-cluster.weaviate.network" \
  weaviate.collection="influencer_profiles" \
  brightdata.base_url="https://api.brightdata.com/datasets/v3" \
  brightdata.poll_interval="30" \
  brightdata.max_urls="50"
```

> Tip: copy `functions/.env.example` to `functions/.env` (git-ignored) for emulator runs. The runtime now loads `.env.runtime*` and repo-level `.env` files automatically via `python-dotenv`, so you don't need to export every variable when developing locally.

## 4. Configure Secrets
Use Firebase/Google Secret Manager for credentials. Example workflow:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set BRIGHTDATA_API_KEY
firebase functions:secrets:set DEEPINFRA_API_KEY
```

These same secret names (`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, etc.) are referenced from `apphosting.yaml` so App Hosting reads the managed values at runtime instead of hardcoding plaintext in configuration files.

BrightData dataset IDs can remain plain env vars if they are not sensitive, but treat API keys as secrets.

## 5. Deploy the Cloud Functions

```bash
firebase deploy --only functions:search_pipeline,functions:search_stage,functions:rerank_stage,functions:brightdata_stage,functions:llm_fit_stage
```

Deployment automatically bundles the lightweight HTTP client; there is no dataset download step.

## 6. Connectivity Checks
- Run `firebase functions:call search_connectivity_check` (or invoke the callable from a script). The response reports OpenAI, BrightData, DeepInfra, and Weaviate connectivity.
- Inspect logs for `WeaviateSearchStage initialized` during the first invocation to confirm configuration.

## 7. Smoke Testing
1. Call `search_pipeline` from the client SDK or via `firebase functions:call` with a simple query.
2. Confirm the response includes `success: true` and creator results.
3. Verify Firestore received `search_pipeline_runs/{pipeline_id}` updates if using the orchestrator.
4. Check Cloud Logs for per-stage timing blocks; failures will include serialized request payloads for faster debugging.

## 8. Emulator vs. Production Configuration
- Never commit emulator-only variables into `apphosting.yaml`. Keep them in `.env` or `functions/.env` instead. At minimum, set the following before starting the emulator suite:
  - `FIREBASE_FUNCTIONS_EMULATOR_ORIGIN=http://127.0.0.1:6200`
  - `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9100` (and `PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` for browser code)
  - `FIRESTORE_EMULATOR_HOST=127.0.0.1:6201`
- The SvelteKit server automatically detects these variables and points `SEARCH_PIPELINE_URL` to the emulator origin. Production builds default to `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/search_pipeline_orchestrator`.
- `functions-client.ts` always mints a Firebase custom token and exchanges it for an ID token before hitting the callable, so downstream functions see the same `request.auth` shape in prod and in the emulator.

## 9. Manual Callable Verification
Use this workflow when debugging auth issues or verifying new deployments without the UI.

1. Mint an ID token via the Admin SDK:
   ```bash
   ID_TOKEN=$(node - <<'NODE'
   import { cert, initializeApp } from 'firebase-admin/app';
   import { getAuth } from 'firebase-admin/auth';

   const projectId = process.env.FIREBASE_PROJECT_ID || process.env.PUBLIC_FIREBASE_PROJECT_ID;
   if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID');
   const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
   const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
   const options = clientEmail && privateKey ? { credential: cert({ projectId, clientEmail, privateKey }), projectId } : { projectId };
   initializeApp(options);

   const customToken = await getAuth().createCustomToken('deployment-check');
   const key = process.env.PUBLIC_FIREBASE_API_KEY;
   const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ token: customToken, returnSecureToken: true })
   });
   const body = await resp.json();
   if (!resp.ok || !body.idToken) throw new Error(JSON.stringify(body));
   console.log(body.idToken);
   NODE
   )
   ```
2. Call the callable endpoint, swapping the origin for the emulator when needed:
   ```bash
   SEARCH_PIPELINE_URL=${SEARCH_PIPELINE_URL:-"https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net/search_pipeline_orchestrator"}
   curl -X POST "$SEARCH_PIPELINE_URL" \
     -H "Authorization: Bearer $ID_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"data":{"pipeline_id":"manual-test","search":{"query":"coffee"},"business_fit_query":"coffee"}}'
   ```

## 10. Auth Troubleshooting
- **401 / UNAUTHENTICATED** – Usually indicates a missing ID token. Double-check the minting step above and ensure the emulator + server share the same `FIREBASE_AUTH_EMULATOR_HOST` value.
- **403 / PERMISSION_DENIED** – The callable rejects unauthenticated requests unless `debug_mode` is true *and* the request is running under the emulator. Verify the stream client sends the correct `Authorization` header.
- **409 / ABORTED** – The new HTTP mapping surfaces this when Firestore rejects concurrent writes. Inspect `search_pipeline_runs/{id}` for stale documents and retry.
- **429 / RESOURCE_EXHAUSTED** – Typically returned by upstream APIs (OpenAI, BrightData) when quota is exceeded. Throttle the caller or request higher limits.
- **499/504 Watchdog errors** – The SSE watchdog now emits `PIPELINE_STATUS_WATCHDOG_EXPIRED`. Confirm Firestore triggers are publishing status documents for the requested `pipeline_id`.

## 11. Troubleshooting
| Symptom | Suggested Fix |
| --- | --- |
| Weaviate timeout or hangs | Confirm `WEAVIATE_URL`/`WEAVIATE_API_KEY`, check cluster health, and ensure egress rules allow outbound HTTPS. Increase the client timeout in `weaviate_client` if needed. |
| SSL certificate errors | Ensure the Weaviate endpoint presents a trusted certificate or configure a custom domain with SSL termination. |
| API returns 4xx/5xx | Inspect logs for the Weaviate payload and HTTP status, validate filters/method, and retry from a local client to rule out network blocks. |
| BrightData stage stuck | Verify dataset IDs and API key, ensure the account has sufficient quota, and check BrightData console for snapshot status. |
| Secrets unavailable | Re-run `firebase functions:secrets:set ...` and redeploy; make sure each function decorator lists the required secrets. |

## 12. Cost Optimization
- Keep `min_instances` at 0 unless you need guaranteed warm instances—external API calls dominate latency now.
- Monitor Weaviate + DeepInfra usage/quotas. If the upstream service is billed per request, consider caching popular queries outside the function.
- Disable optional stages (rerank, BrightData, LLM fit) when not needed to avoid unnecessary API costs.

## 13. Production Considerations
- Use separate Weaviate tenants/projects for staging vs. production to avoid data leakage.
- Monitor the Weaviate and DeepInfra endpoints (uptime checks or third-party synthetic monitors).
- Configure retry/timeout settings per environment if the upstream services offer different SLAs.
- Keep BrightData dataset IDs distinct across environments to decouple test data from production refreshes.

## 14. Support
- File issues or feature requests in this repository.
- Mention the Weaviate/DeepInfra configuration, Firebase project ID, and recent log snippets when requesting help—most issues arise from missing env vars or upstream API responses.
