import { describe, expect, it, vi } from 'vitest';

describe('routes/(app)/chatbot load', () => {
	it('returns initial assistant message', async () => {
		vi.resetModules();

		const { load } = await import('../../../src/routes/(app)/chatbot/+page');
		const result = await load({} as any);

		expect(result.conversation).toHaveLength(1);
		expect(result.conversation[0].role).toBe('assistant');
		expect(result.conversation[0].kind).toBe('bubble');
		expect(typeof result.conversation[0].content).toBe('string');
		expect(new Date(result.conversation[0].created_at).toString()).not.toBe('Invalid Date');
	});
});

