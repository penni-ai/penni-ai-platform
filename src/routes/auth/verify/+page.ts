import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	return {
		mode: url.searchParams.get('mode'),
		oobCode: url.searchParams.get('oobCode')
	};
};
