import { describe, expect, it, vi } from 'vitest';

describe('server/openai', () => {
	it('throws when OPENAI_API_KEY is missing', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: undefined, OPENAI_MODEL: undefined } }));
		vi.doMock('openai', () => ({ default: class OpenAI {} }));

		const mod = await import('../../src/lib/server/openai');
		expect(() => mod.getOpenAIClient()).toThrow(/OPENAI_API_KEY is not set/);
		expect(mod.getOpenAIClientOrNull()).toBeNull();
		expect(mod.DEFAULT_MODEL).toBe('gpt-4o-mini');
	});

	it('creates a singleton client and proxies properties', async () => {
		vi.resetModules();

		class FakeOpenAI {
			public readonly apiKey: string;
			public readonly foo = 'bar';
			constructor(opts: { apiKey: string }) {
				this.apiKey = opts.apiKey;
			}
		}

		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'k1', OPENAI_MODEL: 'gpt-test' } }));
		vi.doMock('openai', () => ({ default: FakeOpenAI }));

		const mod = await import('../../src/lib/server/openai');
		const a = mod.getOpenAIClient();
		const b = mod.getOpenAIClient();
		expect(a).toBe(b);
		expect((a as any).apiKey).toBe('k1');
		expect(mod.getOpenAIClientOrNull()).toBe(a);
		expect((mod.openaiClient as any).foo).toBe('bar');
		expect(mod.DEFAULT_MODEL).toBe('gpt-test');
	});
});

