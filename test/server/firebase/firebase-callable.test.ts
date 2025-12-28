import { describe, expect, it } from 'vitest';

import { decodeCallableResponse } from '../../../src/lib/server/firebase/firebase-callable';

describe('server/firebase/firebase-callable', () => {
	it('returns error=null for OK responses without error envelope', async () => {
		const res = new Response(JSON.stringify({ result: { ok: true } }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
		const decoded = await decodeCallableResponse(res);
		expect(decoded.error).toBeNull();
		expect((decoded.rawBody as any).result.ok).toBe(true);
	});

	it('normalizes callable errors from envelope', async () => {
		const res = new Response(
			JSON.stringify({ error: { status: 'NOT_FOUND', message: 'missing' } }),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
		const decoded = await decodeCallableResponse(res);
		expect(decoded.error?.status).toBe(404);
		expect(decoded.error?.code).toBe('NOT_FOUND');
		expect(decoded.error?.message).toBe('missing');
	});

	it('handles non-JSON responses', async () => {
		const res = new Response('bad gateway', { status: 502 });
		const decoded = await decodeCallableResponse(res);
		expect(decoded.parseError).toBeTruthy();
		expect(decoded.error?.status).toBe(502);
		expect(decoded.error?.code).toBe('FUNCTION_ERROR');
	});

	it('uses error.code and defaults message when envelope omits it', async () => {
		const res = new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
		const decoded = await decodeCallableResponse(res);
		expect(decoded.error?.status).toBe(401);
		expect(decoded.error?.code).toBe('UNAUTHENTICATED');
		expect(decoded.error?.message).toBe('Cloud Function invocation failed.');
	});
});
