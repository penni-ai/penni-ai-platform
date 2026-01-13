import fs from 'node:fs';
import path from 'node:path';

const handlerPath = path.resolve('build/handler.js');

if (!fs.existsSync(handlerPath)) {
	process.exit(0);
}

const original = fs.readFileSync(handlerPath, 'utf8');

let updated = original;
const applied = [];

// Ensure immutable static assets aren't cached by shared proxies (ZAP cache findings).
if (updated.includes("res.setHeader('cache-control', 'public,max-age=31536000,immutable');")) {
	updated = updated.replaceAll(
		"res.setHeader('cache-control', 'public,max-age=31536000,immutable');",
		"res.setHeader('cache-control', 'private,max-age=31536000,immutable');"
	);
	applied.push('static-cache');
}

// Add security headers for all client/static responses served by sirv (these bypass SvelteKit hooks).
if (!updated.includes("res.setHeader('X-Content-Type-Options', 'nosniff');")) {
	updated = updated.replace(
		'// only apply to build directory, not e.g. version.json',
		[
			"res.setHeader('X-Frame-Options', 'DENY');",
			"res.setHeader('X-Content-Type-Options', 'nosniff');",
			"res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');",
			"res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');",
			"if (res.statusCode === 200) {",
			"\tres.setHeader('cache-control', 'private,max-age=0,must-revalidate');",
			"\tres.setHeader('pragma', 'no-cache');",
			"\tres.setHeader('expires', '0');",
			'}',
			'// only apply to build directory, not e.g. version.json'
		].join('\n\t\t\t\t\t\t\t\t')
	);
	applied.push('static-headers');
}

// Block rarely used methods on non-API paths at the adapter level (covers static assets too).
if (!updated.includes('const __apphosting_method_guard')) {
	const guard = [
		'const __apphosting_method_guard = (req, res, next) => {',
		"\tconst method = (req.method || '').toUpperCase();",
		"\tif (method === 'TRACE' || method === 'TRACK') {",
		"\t\tres.statusCode = 405;",
		"\t\tres.setHeader('content-type', 'text/plain; charset=utf-8');",
		"\t\tres.setHeader('X-Frame-Options', 'DENY');",
		"\t\tres.setHeader('X-Content-Type-Options', 'nosniff');",
		"\t\tres.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');",
		"\t\tres.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');",
		"\t\tres.setHeader('cache-control', 'no-store');",
		"\t\tres.setHeader('pragma', 'no-cache');",
		"\t\tres.setHeader('expires', '0');",
		"\t\tres.end('Method Not Allowed');",
		'\t\treturn;',
		'\t}',
		"\tif (method === 'OPTIONS') {",
		"\t\tconst url = req.url || '';",
		"\t\tconst pathname = url.split('?')[0] || '';",
		"\t\tconst apiPrefix = `${base}/api`;",
		"\t\tconst isApi = pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`);",
		'\t\tif (!isApi) {',
		'\t\t\tres.statusCode = 405;',
		"\t\t\tres.setHeader('content-type', 'text/plain; charset=utf-8');",
		"\t\t\tres.setHeader('X-Frame-Options', 'DENY');",
		"\t\t\tres.setHeader('X-Content-Type-Options', 'nosniff');",
		"\t\t\tres.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');",
		"\t\t\tres.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');",
		"\t\t\tres.setHeader('cache-control', 'no-store');",
		"\t\t\tres.setHeader('pragma', 'no-cache');",
		"\t\t\tres.setHeader('expires', '0');",
		"\t\t\tres.end('Method Not Allowed');",
		'\t\t\treturn;',
		'\t\t}',
		'\t}',
		'\treturn next();',
		'};',
		''
	].join('\n');

	updated = updated.replace('const handler = sequence(', `${guard}const handler = sequence(`);
	updated = updated.replace(
		"([serve(path.join(dir, 'client'), true), serve_prerendered(), ssr].filter(Boolean))",
		"([__apphosting_method_guard, serve(path.join(dir, 'client'), true), serve_prerendered(), ssr].filter(Boolean))"
	);
	applied.push('method-guard');
}

if (updated === original) {
	console.warn('[postbuild-apphosting-hardening] No changes applied (unexpected handler format).');
	process.exit(0);
}

fs.writeFileSync(handlerPath, updated, 'utf8');
console.log(`[postbuild-apphosting-hardening] Patched build/handler.js (${applied.join(', ') || 'unknown'}).`);
