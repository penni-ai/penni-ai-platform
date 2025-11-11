---
title: ChatGPT_Integration_Plan
type: note
permalink: plans/chat-gpt-integration-plan
---

Goal: Add a ChatGPT-powered assistant that collects campaign details from users, then triggers Penny’s search API.

Architecture:
- Browser (SvelteKit) sends chat messages to App Hosting server APIs.
- App Hosting endpoints talk to Cloud Functions / Cloud Run code that orchestrates the ChatGPT call using secrets stored in Google Secret Manager.
- Firestore stores conversation history, collected fields, and search results; status fields track when all data is ready.
- Once required fields are gathered, backend calls Penny’s search API, stores response in Firestore, and returns results to the UI.

Implementation steps:
1. Conversation schema in Firestore (history, collected fields, status, search results).
2. Secrets (OpenAI, search API) in Secret Manager; env references in apphosting.yaml.
3. SvelteKit endpoints: create session, send message, fetch history.
4. Cloud Function builds prompt (system instructions + history), calls OpenAI, streams response back, extracts structured fields via JSON mode, updates Firestore.
5. When all fields captured, trigger search API, persist results in conversation document.
6. Frontend chat UI consumes streaming responses and updates according to conversation status.
7. Moderate content / apply safety filters.
8. Telemetry: log conversion metrics, token usage.

Security best practices:
- OpenAI key only on server; never exposed to client. Use Secret Manager + `$env/dynamic/private`.
- Authorized domains for Firebase Auth.
- No secrets in source control.

Future enhancements: resume conversations, tool integration, analytics dashboards.