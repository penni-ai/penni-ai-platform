import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/sign-in');
	}

	return {
		user: {
			uid: locals.user.uid,
			email: locals.user.email ?? null
		}
	};
};
