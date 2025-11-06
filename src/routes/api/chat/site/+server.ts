import { json } from '@sveltejs/kit';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { siteDocRef } from '$lib/server/firestore';

const MAX_CHARS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

export const POST = async ({ request, locals }) => {
	const uid = locals.user?.uid ?? null;
	if (!uid) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch (error) {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const urlValue = typeof (body as Record<string, unknown>)?.url === 'string' ? (body as Record<string, unknown>).url : null;
	if (!urlValue || !isValidUrl(urlValue)) {
		return json({ error: 'A valid http(s) URL is required.' }, { status: 400 });
	}

	try {
		const { textContent, title } = await fetchAndExtract(urlValue);
		const truncated = textContent.slice(0, MAX_CHARS);
		const siteRef = siteDocRef(uid, new URL(urlValue).hostname);
		await siteRef.set({
			url: urlValue,
			title: title ?? '',
			rawText: truncated,
			capturedAt: Date.now()
		});

		return json({ status: 'succeeded', length: truncated.length });
	} catch (error) {
		console.error('[chat] site fetch failed', error);
		return json({ error: error instanceof Error ? error.message : 'Unable to fetch site' }, { status: 500 });
	}
};

function isValidUrl(raw: string) {
	try {
		const parsed = new URL(raw);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

async function fetchAndExtract(url: string) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	const response = await fetch(url, {
		signal: controller.signal,
		redirect: 'follow',
		headers: {
			'User-Agent': 'PenniSiteFetcher/1.0 (+https://penni-ai.com)'
		}
	});
	clearTimeout(timeout);

	if (!response.ok) {
		throw new Error(`Fetch failed with status ${response.status}`);
	}

	const contentType = response.headers.get('content-type');
	if (!contentType || !contentType.includes('text/html')) {
		throw new Error('Site must return text/html content.');
	}

	const html = await response.text();
	const dom = new JSDOM(html, { url });
	const reader = new Readability(dom.window.document);
	const article = reader.parse();

	let textContent = article?.textContent?.trim() ?? '';
	let title = article?.title ?? dom.window.document.title ?? '';

	if (!textContent) {
		textContent = dom.window.document.body?.textContent?.trim() ?? '';
	}

	if (!textContent) {
		throw new Error('No readable text found on page.');
	}

	return { textContent, title };
}
