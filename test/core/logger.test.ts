import { describe, expect, it, vi } from 'vitest';

describe('core/logger', () => {
	it('writes structured JSON and strips undefined', async () => {
		vi.resetModules();
		vi.restoreAllMocks();
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});

		const { createLogger } = await import('../../src/lib/server/core/logger');
		const logger = createLogger({ requestId: 'r1', component: 'test' });
		logger.info('hello', { a: 1, b: undefined });

		expect(info).toHaveBeenCalledTimes(1);
		const line = String(info.mock.calls[0]?.[0] ?? '');
		const parsed = JSON.parse(line);
		expect(parsed.severity).toBe('INFO');
		expect(parsed.requestId).toBe('r1');
		expect(parsed.component).toBe('test');
		expect(parsed.message).toBe('hello');
		expect(parsed.a).toBe(1);
		expect('b' in parsed).toBe(false);
	});

	it('sanitizes Error objects and supports child context', async () => {
		vi.resetModules();
		vi.restoreAllMocks();
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { createLogger } = await import('../../src/lib/server/core/logger');
		const base = createLogger({ requestId: 'r1' });
		const child = base.child({ component: 'child' });
		child.error('boom', { err: new Error('nope'), arr: [new Error('nested')] });

		const parsed = JSON.parse(String(error.mock.calls[0]?.[0] ?? ''));
		expect(parsed.severity).toBe('ERROR');
		expect(parsed.requestId).toBe('r1');
		expect(parsed.component).toBe('child');
		expect(parsed.err?.message).toBe('nope');
		expect(parsed.err?.name).toBe('Error');
		expect(parsed.arr?.[0]?.message).toBe('nested');
	});
});
