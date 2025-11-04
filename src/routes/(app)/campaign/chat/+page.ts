import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	return {
		sessions: [
			{ id: 'cmp-001', name: 'Student AI Campaign', updated_at: '2025-01-14T18:30:00Z' },
			{ id: 'cmp-003', name: 'Summer Menu Launch', updated_at: '2025-01-08T10:00:00Z' }
		]
	};
};
