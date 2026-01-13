import type { RequestHandler } from './$types';
import { env as publicEnv } from '$env/dynamic/public';

export const GET: RequestHandler = async ({ url }) => {
	const origin = publicEnv.PUBLIC_SITE_URL || url.origin;
	const pages = ['/', '/sign-in', '/sign-up', '/privacy', '/terms'];
	const lastmod = new Date().toISOString();

	const entries = pages
		.map((path) => `<url><loc>${origin}${path}</loc><lastmod>${lastmod}</lastmod></url>`)
		.join('');

	const body = `<?xml version="1.0" encoding="UTF-8"?>` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
		entries +
		`</urlset>`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8'
		}
	});
};

