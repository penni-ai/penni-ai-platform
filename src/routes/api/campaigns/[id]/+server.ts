import { json } from '@sveltejs/kit';
import { campaignDocRef } from '$lib/server/firestore';

export const GET = async ({ locals, params }) => {
	const uid = locals.user?.uid ?? null;
	if (!uid) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const doc = await campaignDocRef(uid, params.id).get();
	if (!doc.exists)
		return json({ error: 'Campaign not found' }, { status: 404 });

	return json(doc.data());
};
