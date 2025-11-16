# Chatbot Migration Guide

This document outlines the steps to migrate from the legacy TypeScript + OpenAI chat stack to the new Python `penni-chatbot` service that runs on Cloud Run with Vertex AI and Cloud SQL.

## Architecture Comparison

| Capability | Legacy (TypeScript) | New Service |
|------------|--------------------|-------------|
| LLM stack | OpenAI Responses API via SvelteKit functions | LangGraph workflow calling Vertex AI (Gemini) |
| State persistence | Firestore (`chat` subcollection + collected doc) | Cloud SQL checkpoints + message log, Firestore only stores collected slots |
| Deployment | Firebase Functions runtime | Cloud Run container + Cloud SQL |
| Authentication | Firebase ID token checked inside SvelteKit | Firebase ID token validated directly in FastAPI |

## Migration Steps

1. **Provision Infrastructure**
   - Run `infrastructure/cloudsql-setup.sh` to create the Cloud SQL instance, database, and schema.
   - Store secrets via `infrastructure/secrets-setup.sh` and grant the Cloud Run service account access.

2. **Deploy the Python Service**
   - Build and deploy with `penni-chatbot/deploy.sh` (or manual `gcloud builds submit` + `gcloud run deploy`).
   - Verify health with `curl https://<service-url>/health`.

3. **Update Frontend / API**
   - Add `CHATBOT_SERVICE_URL` to `apphosting.yaml`.
   - Modify `src/lib/server/chat/chatbot-client.ts` to call the new REST API (send Firebase ID token, handle responses).
   - Update `src/routes/api/chat/[campaignId]/+server.ts` and `/stream/+server.ts` to proxy to the Cloud Run service instead of OpenAI helpers.
   - Keep `createCampaign` logic for now (campaign creation + Firestore doc), but remove Firestore `chat` writes; messages now live exclusively in Cloud SQL.

4. **Data Consistency**
   - The Python service writes collected slot data back to Firestore via `FirestoreSync`, so downstream analytics continue to work.
   - During rollout, enable a feature flag in SvelteKit to switch per user/campaign if desired.

5. **Rollback Plan**
   - Keep the old OpenAI-based functions behind a flag. If Cloud Run has issues, toggle the flag to route chat requests back to the legacy handler.
   - Because Firestore schema remains the same, no data migration is needed for rollback.

6. **Monitoring & Observability**
   - Logs emit JSON compatible with Cloud Logging (`logging_config.py`).
   - Add alerts for Cloud Run errors and Cloud SQL CPU utilization.

7. **Cost Considerations**
   - Cloud SQL introduces a fixed baseline cost (db-custom-1-3840 recommended). Resize for production workloads.
   - Vertex AI (Gemini) usage replaces OpenAI spend; ensure quotas are requested for the chosen region.

8. **Checklist**
   - [ ] Cloud SQL + secrets provisioned
   - [ ] Cloud Run service deployed and accessible
   - [ ] SvelteKit environment configured with `CHATBOT_SERVICE_URL`
   - [ ] API routes switched to new client
   - [ ] Streaming endpoint verified
   - [ ] Firestore collected data updates observed
   - [ ] Rollback flag documented

## Troubleshooting

- **Missing messages after migration**: confirm `conversation_messages` table is populated and that the SvelteKit client is rendering messages returned by the new API.
- **Firestore not updating**: ensure the Cloud Run service account has `roles/datastore.user` and `GOOGLE_APPLICATION_CREDENTIALS`/ADC is configured.
- **Vertex AI quota errors**: check Cloud Monitoring for `RESOURCE_EXHAUSTED` and request higher quotas in the region set by `GOOGLE_CLOUD_REGION`.
