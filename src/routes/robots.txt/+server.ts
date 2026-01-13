import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const body = `User-agent: *\nDisallow:\n`;
	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8'
		}
	});
};

