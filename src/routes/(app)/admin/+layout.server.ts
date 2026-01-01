import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isAdminUser } from '$lib/server/core';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(303, '/sign-in');
	}
	if (!isAdminUser(user)) {
		throw error(403, 'Admin access required.');
	}

	return {
		adminUser: {
			uid: user.uid,
			email: user.email ?? null
		}
	};
};
