import { describe, expect, it, vi } from 'vitest';

describe('server/firebase/functions-client', () => {
	it('throws when FIREBASE project ID is missing', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_PROJECT_ID;
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;

		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: undefined } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const mod = await import('../../../src/lib/server/firebase/functions-client');
		expect(() => mod.getSearchPipelineUrl()).toThrow(/FIREBASE_PROJECT_ID/);
	});

	it('throws when using Auth emulator with mismatched .firebaserc default', async () => {
		vi.resetModules();
		process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
		process.env.FIREBASE_PROJECT_ID = 'wrong-project';
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;

		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'wrong-project' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const mod = await import('../../../src/lib/server/firebase/functions-client');
		expect(() => mod.getFunctionsConfig()).toThrow(/does not match \.firebaserc default/);
	});

	it('builds Cloud Functions URLs (production + emulator)', async () => {
		vi.resetModules();

		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		delete process.env.FIREBASE_FUNCTIONS_REGION;
		process.env.FIREBASE_PROJECT_ID = 'penni-ai-platform';

		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const prod = await import('../../../src/lib/server/firebase/functions-client');
		expect(prod.getSearchPipelineUrl()).toBe(
			'https://us-central1-penni-ai-platform.cloudfunctions.net/search_pipeline_orchestrator'
		);
		expect(prod.getLegacySearchPipelineUrl()).toContain('/search_pipeline');

		vi.resetModules();
		process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN = 'http://localhost:5001/';
		process.env.FIREBASE_FUNCTIONS_REGION = 'europe-west1';
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const emu = await import('../../../src/lib/server/firebase/functions-client');
		expect(emu.getSearchPipelineUrl()).toBe(
			'http://localhost:5001/penni-ai-platform/europe-west1/search_pipeline_orchestrator'
		);
	});

	it('mintIdToken throws when PUBLIC_FIREBASE_API_KEY missing (non-emulator)', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;

		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform', PUBLIC_FIREBASE_API_KEY: undefined }
		}));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const { mintIdToken } = await import('../../../src/lib/server/firebase/functions-client');
		await expect(mintIdToken('u1')).rejects.toMatchObject({ code: 'CONFIG_MISSING', status: 500 });
	});

	it('mintIdToken uses Auth emulator when configured', async () => {
		vi.resetModules();
		process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;

		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform', PUBLIC_FIREBASE_API_KEY: undefined }
		}));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct_u1') }, adminDb: {} }));

		const fetchSpy = vi.fn(async (url: string) => {
			expect(url).toContain('http://127.0.0.1:9099/identitytoolkit.googleapis.com');
			return new Response(JSON.stringify({ idToken: 'id_token' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { mintIdToken } = await import('../../../src/lib/server/firebase/functions-client');
		expect(await mintIdToken('u1')).toBe('id_token');
	});

	it('mintIdToken throws TOKEN_EXCHANGE_FAILED on non-OK response', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;

		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform', PUBLIC_FIREBASE_API_KEY: 'key' }
		}));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct_u1') }, adminDb: {} }));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: { message: 'BAD' } }), { status: 400 }))
		);

		const { mintIdToken } = await import('../../../src/lib/server/firebase/functions-client');
		await expect(mintIdToken('u1')).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED', status: 500 });
	});

	it('invokeSearchPipeline adds Authorization + callable envelope', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN = 'http://localhost:5001';
		process.env.FIREBASE_FUNCTIONS_REGION = 'us-central1';
		process.env.FIREBASE_PROJECT_ID = 'penni-ai-platform';

		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform', PUBLIC_FIREBASE_API_KEY: 'key' }
		}));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct_u1') }, adminDb: {} }));

		const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
			if (String(url).includes('accounts:signInWithCustomToken')) {
				return new Response(JSON.stringify({ idToken: 'id_token' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			expect(String(url)).toContain('/search_pipeline_orchestrator');
			const headers = init?.headers as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer id_token');
			const body = JSON.parse(String(init?.body));
			expect(body.data.pipeline_id).toBe('pipe_1');
			expect(body.data.search.query).toBe('coffee');
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { invokeSearchPipeline } = await import('../../../src/lib/server/firebase/functions-client');
		const res = await invokeSearchPipeline(
			{ search: { query: 'coffee' }, business_fit_query: 'coffee' } as any,
			{ uid: 'u1', pipelineId: 'pipe_1' }
		);
		expect(res.status).toBe(200);
	});

	it('invokeLegacySearchPipeline ignores pipelineId and forwards AbortSignal', async () => {
		vi.resetModules();
		process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
		process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN = 'http://localhost:5001';
		process.env.FIREBASE_FUNCTIONS_REGION = 'us-central1';
		process.env.FIREBASE_PROJECT_ID = 'penni-ai-platform';

		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform', PUBLIC_FIREBASE_API_KEY: undefined }
		}));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct_u1') }, adminDb: {} }));

		const controller = new AbortController();
		const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
			if (String(_url).includes('accounts:signInWithCustomToken')) {
				return new Response(JSON.stringify({ idToken: 'id_token' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			expect(init?.signal).toBe(controller.signal);
			const body = JSON.parse(String(init?.body));
			expect(body.data.pipeline_id).toBeUndefined();
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { invokeLegacySearchPipeline } = await import('../../../src/lib/server/firebase/functions-client');
		const res = await invokeLegacySearchPipeline(
			{ search: { query: 'coffee' }, business_fit_query: 'coffee' } as any,
			{ uid: 'u1', pipelineId: 'pipe_1', signal: controller.signal }
		);
		expect(res.status).toBe(200);
	});

	it('getFunctionsConfig reads Auth emulator origin from public env and keeps empty strings', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;
		process.env.FIREBASE_PROJECT_ID = 'penni-ai-platform';

		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform',
				PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: '   '
			}
		}));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const mod = await import('../../../src/lib/server/firebase/functions-client');
		const cfg = mod.getFunctionsConfig();
		expect(cfg.PROJECT_ID).toBe('penni-ai-platform');
		expect(cfg.AUTH_EMULATOR_ORIGIN).toBe('');
	});

	it('ignores .firebaserc mismatch check when .firebaserc cannot be read', async () => {
		vi.resetModules();
		process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
		process.env.FIREBASE_PROJECT_ID = 'some-project';
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;

		vi.doMock('node:fs', () => ({ readFileSync: () => { throw new Error('nope'); } }));
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'some-project' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const mod = await import('../../../src/lib/server/firebase/functions-client');
		expect(mod.getSearchPipelineUrl()).toContain('some-project');
	});

	it('getCloudRunPipelineUrl trims slashes and throws when missing', async () => {
		vi.resetModules();
		delete process.env.CLOUD_RUN_PIPELINE_SERVICE_URL;
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const { getCloudRunPipelineUrl } = await import('../../../src/lib/server/firebase/functions-client');
		expect(() => getCloudRunPipelineUrl()).toThrow(/CLOUD_RUN_PIPELINE_SERVICE_URL/);

		process.env.CLOUD_RUN_PIPELINE_SERVICE_URL = 'https://pipeline.example.com///';
		expect(getCloudRunPipelineUrl()).toBe('https://pipeline.example.com');
	});

	it('getServiceAccountAccessToken returns emulator-token in Functions emulator mode', async () => {
		vi.resetModules();
		process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN = 'http://localhost:5001';
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const { getServiceAccountAccessToken } = await import('../../../src/lib/server/firebase/functions-client');
		expect(await getServiceAccountAccessToken('aud')).toBe('emulator-token');
	});

	it('getServiceAccountAccessToken uses GoogleAuth and caches per audience', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		process.env.FIREBASE_PROJECT_ID = 'penni-ai-platform';

		const getIdTokenClient = vi.fn(async () => ({
			getRequestHeaders: vi.fn(async () => new Headers({ Authorization: 'Bearer token_1' }))
		}));

		vi.doMock('google-auth-library', () => ({
			GoogleAuth: class GoogleAuthMock {
				constructor(_opts: any) {}
				getIdTokenClient(aud: string) {
					return getIdTokenClient(aud);
				}
			}
		}));

		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const { getServiceAccountAccessToken } = await import('../../../src/lib/server/firebase/functions-client');
		expect(await getServiceAccountAccessToken('aud1')).toBe('token_1');
		expect(await getServiceAccountAccessToken('aud1')).toBe('token_1');
		expect(getIdTokenClient).toHaveBeenCalledTimes(1);
	});

	it('getServiceAccountAccessToken throws SERVICE_ACCOUNT_AUTH_FAILED on invalid headers', async () => {
		vi.resetModules();
		delete process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN;
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		process.env.FIREBASE_PROJECT_ID = 'penni-ai-platform';

		vi.doMock('google-auth-library', () => ({
			GoogleAuth: class GoogleAuthMock {
				constructor(_opts: any) {}
				async getIdTokenClient() {
					return {
						getRequestHeaders: async () => new Headers()
					};
				}
			}
		}));

		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_PROJECT_ID: 'penni-ai-platform' } }));
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { createCustomToken: vi.fn(async () => 'ct') }, adminDb: {} }));

		const { getServiceAccountAccessToken } = await import('../../../src/lib/server/firebase/functions-client');
		await expect(getServiceAccountAccessToken('aud2')).rejects.toMatchObject({
			code: 'SERVICE_ACCOUNT_AUTH_FAILED',
			status: 500
		});
	});
});
