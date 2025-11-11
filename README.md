# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Cloud Functions Deployment

This repo also includes Firebase Cloud Functions that power the creator search pipeline. The runtime now calls the hosted creator search API, so cold starts no longer download LanceDB snapshots.

- Read `functions/README.md` for a full overview, configuration guide, and local development workflow.
- Follow `functions/DEPLOYMENT.md` to configure search API variables, set secrets, and deploy.
- Quick deploy command: `firebase deploy --only functions` (or `--only functions:search_pipeline`).
- Verify logs for `Creator search engine initialized with external API` after deployment to ensure connectivity.

## Emulator vs. Production Call Paths

### Required Emulator Environment Variables
Set these when running `firebase emulators:start` or `npm run dev` so that both the SvelteKit server and Cloud Functions share the same targets:

- `FIREBASE_FUNCTIONS_EMULATOR_ORIGIN=http://127.0.0.1:6200`
- `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9100` (and `PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=http://127.0.0.1:9100` for the client)
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:6201`

Keep these **out** of `apphosting.yaml`; they belong in your local `.env` which is already git-ignored. Production builds should only see the managed Cloud Run / Cloud Functions endpoints.

### How ID Tokens Are Minted
`src/lib/server/functions-client.ts` uses the Firebase Admin SDK to create a custom token for the signed-in user (or `server-service-user` for trusted jobs). It then exchanges that custom token for an ID token via Identity Toolkit (or the Auth emulator). Every call to `invokeSearchPipeline` automatically attaches `Authorization: Bearer <id_token>` so callable Cloud Functions receive the same auth context as the host app.

### Callable URLs
- Production: `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/search_pipeline_orchestrator`
- Emulator: `${FIREBASE_FUNCTIONS_EMULATOR_ORIGIN}/search_pipeline_orchestrator`

`SEARCH_PIPELINE_URL` in `functions-client.ts` picks the correct origin automatically once the env vars above are set.

### Verifying with curl
1. Mint an ID token (run inside the repo so `.env` is loaded):
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

   const customToken = await getAuth().createCustomToken('debug-user');
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
2. Call the callable endpoint:
   ```bash
   curl -X POST "$SEARCH_PIPELINE_URL" \
     -H "Authorization: Bearer $ID_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"data":{"pipeline_id":"dev-test","search":{"query":"coffee"},"business_fit_query":"coffee"}}'
   ```
3. When using the emulator, swap `$SEARCH_PIPELINE_URL` with `http://127.0.0.1:6200/search_pipeline_orchestrator`.

## Troubleshooting Auth Failures

- **401 / UNAUTHENTICATED** – Ensure `FIREBASE_AUTH_EMULATOR_HOST` matches the emulator port and that the caller supplied a valid ID token. When running locally, check that `PUBLIC_FIREBASE_API_KEY` is set so the server can mint tokens.
- **403 / PERMISSION_DENIED** – The callable enforces Firebase Authentication. Confirm the user exists in the Auth emulator or Firebase project and that Firestore security rules allow the `search_pipeline_runs` writes it performs.
- **409 / ABORTED or 504 / DEADLINE_EXCEEDED** – These often trace back to long-running pipeline stages. The streaming SSE endpoint now emits watchdog errors; if you see them frequently, inspect Cloud Logs for stuck Firestore listeners.
- **500 / INTERNAL or 503 / UNAVAILABLE** – Indicates upstream dependency issues (OpenAI, BrightData, etc.). Re-run `firebase functions:log --only search_pipeline_orchestrator` to locate the failing stage and validate secrets.
