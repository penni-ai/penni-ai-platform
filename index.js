import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { createReadableStream, getRequest, setResponse } from '@sveltejs/kit/node';

const buildEntry = new URL('./build/index.js', import.meta.url);

// Prefer the adapter output when present (e.g. local builds).
if (fs.existsSync(buildEntry)) {
	await import(buildEntry.href);
	process.exit(0);
}

const outputServerEntry = new URL('./.svelte-kit/output/server/index.js', import.meta.url);
const outputManifestEntry = new URL('./.svelte-kit/output/server/manifest.js', import.meta.url);
const outputClientDir = new URL('./.svelte-kit/output/client/', import.meta.url);

if (!fs.existsSync(outputServerEntry) || !fs.existsSync(outputManifestEntry) || !fs.existsSync(outputClientDir)) {
	console.error(
		`Missing SvelteKit output. build=${fs.existsSync(buildEntry)} output_server=${fs.existsSync(outputServerEntry)} output_manifest=${fs.existsSync(outputManifestEntry)} output_client=${fs.existsSync(outputClientDir)}`
	);
	process.exit(1);
}

const { Server } = await import(outputServerEntry.href);
const { manifest } = await import(outputManifestEntry.href);

const dir = path.dirname(fileURLToPath(import.meta.url));
const client_dir = path.join(dir, '.svelte-kit', 'output', 'client');
const server = new Server(manifest);

await server.init({
	env: /** @type {Record<string, string>} */ (process.env),
	read: (file) => createReadableStream(path.join(client_dir, file))
});

/** @param {import('http').OutgoingHttpHeaders} headers */
function header(headers, key) {
	const value = headers[key];
	return Array.isArray(value) ? value[0] : value;
}

/** @param {import('http').IncomingHttpHeaders} headers */
function get_origin(headers) {
	const forwardedProto = header(headers, 'x-forwarded-proto')?.toString()?.split(',')[0]?.trim();
	const forwardedHost = header(headers, 'x-forwarded-host')?.toString()?.split(',')[0]?.trim();
	const proto = forwardedProto || 'https';
	const host = forwardedHost || header(headers, 'host') || 'localhost';
	return `${proto}://${host}`;
}

/** @param {import('http').ServerResponse} res */
function applySecurityHeaders(res) {
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** @param {string} url */
function pathnameFromUrl(url) {
	const idx = url.indexOf('?');
	return idx === -1 ? url : url.slice(0, idx);
}

/** @param {import('http').ServerResponse} res */
function respondMethodNotAllowed(res) {
	res.statusCode = 405;
	applySecurityHeaders(res);
	res.setHeader('content-type', 'text/plain; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('pragma', 'no-cache');
	res.setHeader('expires', '0');
	res.end('Method Not Allowed');
}

const serve_client = sirv(client_dir, {
	etag: true,
	gzip: true,
	brotli: true,
	setHeaders: (res, pathname) => {
		applySecurityHeaders(res);

		if (res.statusCode === 200) {
			res.setHeader('cache-control', 'private,max-age=0,must-revalidate');
			res.setHeader('pragma', 'no-cache');
			res.setHeader('expires', '0');
		}

		// Only apply immutable caching to fingerprinted build assets.
		if (pathname.startsWith(`/${manifest.appPath}/immutable/`) && res.statusCode === 200) {
			res.setHeader('cache-control', 'private,max-age=31536000,immutable');
		}
	}
});

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '3000');

const httpServer = http.createServer((req, res) => {
	const method = (req.method || 'GET').toUpperCase();
	const pathname = pathnameFromUrl(req.url || '/');
	const isApi = pathname === '/api' || pathname.startsWith('/api/');

	if (method === 'TRACE' || method === 'TRACK') {
		return respondMethodNotAllowed(res);
	}

	if (method === 'OPTIONS' && !isApi) {
		return respondMethodNotAllowed(res);
	}

	serve_client(req, res, async () => {
		let request;
		try {
			request = await getRequest({
				base: process.env.ORIGIN || get_origin(req.headers),
				request: req
			});
		} catch {
			applySecurityHeaders(res);
			res.statusCode = 400;
			res.setHeader('content-type', 'text/plain; charset=utf-8');
			res.end('Bad Request');
			return;
		}

		await setResponse(
			res,
			await server.respond(request, {
				platform: { req },
				getClientAddress: () => header(req.headers, 'x-forwarded-for')?.toString()?.split(',')[0]?.trim() || req.socket.remoteAddress
			})
		);
	});
});

httpServer.listen({ host, port }, () => {
	console.log(`Listening on http://${host}:${port}`);
});
