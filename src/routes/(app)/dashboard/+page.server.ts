import type { PageServerLoad } from './$types';
import type { LayoutData } from '../$types';

export const load: PageServerLoad = async ({ parent }) => {
	// Use campaigns from layout
	const layoutData = await parent() as LayoutData;
	return {
		campaigns: layoutData.campaigns ?? []
	};
};

