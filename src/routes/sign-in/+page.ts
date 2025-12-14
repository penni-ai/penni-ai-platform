import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	return {
		verifiedNotice: url.searchParams.get('verified') === '1'
	};
};
