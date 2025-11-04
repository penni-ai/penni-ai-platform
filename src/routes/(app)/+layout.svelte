<script lang="ts">
	import { page } from '$app/stores';
	import DashboardShell from '$lib/components/DashboardShell.svelte';

	let { children } = $props();

	const campaigns = [
		{ id: 'student-ai-campaign', name: 'Student AI Campaign', href: '/campaign/student-ai-campaign' },
		{ id: 'july-fourth-campaign', name: 'July Fourth Campaign', href: '/campaign/july-fourth-campaign' },
		{ id: 'club-free-drinks-campaign', name: 'Club Free Drinks Campaign', href: '/campaign/club-free-drinks-campaign' }
	];

	const pathname = $derived(() => $page.url.pathname);
	const activeCampaignId = $derived(() => {
		const path = pathname();
		if (path.startsWith('/campaign/')) {
			return path.split('/')[2] ?? null;
		}
		return path === '/chat' ? 'student-ai-campaign' : null;
	});
</script>

<DashboardShell campaigns={campaigns} activeCampaignId={activeCampaignId()} showToggleControls={false}>
	{@render children()}
</DashboardShell>
