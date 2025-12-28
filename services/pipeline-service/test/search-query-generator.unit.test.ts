import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('search-query-generator (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.OPENAI_API_KEY = 'sk-test-key';
		delete process.env.OPENAI_MODEL;
	});

	it('parses 12 queries and strips arrow annotations / headings', async () => {
		const create = vi.fn(async () => ({
			choices: [
				{
					message: {
						content: [
							'PART 1 - BROAD QUERIES (4 total):',
							'san francisco ← location',
							'coffee',
							'# comment should be ignored',
							'foodie',
							'food',
							'PART 2 - SPECIFIC QUERIES (2 total):',
							'sf coffee',
							'bay area coffee',
							'PART 3 - ADJACENT QUERIES (6 total):',
							'bay area',
							'oakland',
							'berkeley',
							'lifestyle',
							'blogger',
							'creator'
						].join('\n')
					}
				}
			]
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');

		const result = await generateSearchQueriesFromDescription('  Coffee shop in SF  ');
		expect(result.description).toBe('Coffee shop in SF');
		expect(result.queries).toHaveLength(12);
		expect(result.queries[0]).toBe('san francisco');
		expect(result.queries).toContain('sf coffee');
	});

	it('throws on empty description', async () => {
		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create: vi.fn() } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');
		await expect(generateSearchQueriesFromDescription('   ')).rejects.toThrow(/Description is required/);
	});

	it('throws on invalid OpenAI key format', async () => {
		process.env.OPENAI_API_KEY = 'not-a-key';

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create: vi.fn() } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');
		await expect(generateSearchQueriesFromDescription('desc')).rejects.toThrow(/Invalid OpenAI API key format/);
	});

	it('throws when OPENAI_API_KEY is missing', async () => {
		delete process.env.OPENAI_API_KEY;

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create: vi.fn() } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');
		await expect(generateSearchQueriesFromDescription('desc')).rejects.toThrow(/OPENAI_API_KEY environment variable is required/);
	});

	it('surfaces empty/invalid model responses', async () => {
		const create = vi.fn(async () => ({ choices: [] }));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');
		await expect(generateSearchQueriesFromDescription('desc')).rejects.toThrow(/No choices returned/);
	});

	it('throws when OpenAI returns no text', async () => {
		const create = vi.fn(async () => ({
			choices: [
				{
					message: {
						content: ''
					}
				}
			]
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');
		await expect(generateSearchQueriesFromDescription('desc')).rejects.toThrow(/No text generated/);
	});

	it('throws when response contains no valid queries', async () => {
		const create = vi.fn(async () => ({
			choices: [
				{
					message: {
						content: ['PART 1 - BROAD QUERIES (4 total):', 'PART 2 - SPECIFIC QUERIES (2 total):'].join('\n')
					}
				}
			]
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				chat = { completions: { create } };
				constructor(_opts: any) {}
			}
		}));

		const { generateSearchQueriesFromDescription } = await import('../dist/utils/search-query-generator.js');
		await expect(generateSearchQueriesFromDescription('desc')).rejects.toThrow(/No valid queries generated/);
	});
});
