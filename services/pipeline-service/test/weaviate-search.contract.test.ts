import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deduplicateResults } from '../dist/utils/weaviate-search.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'fixtures', 'external');

function loadFixture<T = unknown>(name: string): T {
	const filePath = path.join(fixturesDir, name);
	const raw = fs.readFileSync(filePath, 'utf8');
	return JSON.parse(raw) as T;
}

describe('weaviate search (external fixtures)', () => {
	it('deduplicates a real hybrid search result payload shape', () => {
		const hybrid = loadFixture<any>('weaviate.hybrid.sample.json');
		expect(hybrid).toBeTruthy();
		expect(Array.isArray(hybrid.results)).toBe(true);

		const results = hybrid.results as any[];
		expect(results.length).toBeGreaterThan(0);

		const deduped = deduplicateResults(results);
		expect(Array.isArray(deduped)).toBe(true);
		expect(deduped.length).toBeLessThanOrEqual(results.length);

		for (const item of deduped) {
			const url = item?.data?.profile_url || item?.profile_url || item?.url;
			expect(typeof url).toBe('string');
			expect(url.length).toBeGreaterThan(0);
		}
	});
});

