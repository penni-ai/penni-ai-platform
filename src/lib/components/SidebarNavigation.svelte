<script lang="ts">
	import Button from '$lib/components/Button.svelte';

	type NavItem = {
		label: string;
		href: string;
		icon: 'settings' | 'account' | 'inbox';
		badge?: number;
	};

	type CampaignLink = {
		id: string;
		name: string;
		href?: string;
	};

	interface Props {
		campaigns?: CampaignLink[];
		selectedCampaignId?: string | null;
	}

	const navItems: NavItem[] = [
		{ label: 'Settings', href: '/settings', icon: 'settings' },
		{ label: 'My Account', href: '/my-account', icon: 'account' },
		{ label: 'Inbox', href: '/inbox', icon: 'inbox', badge: 2 }
	];

	let {
		campaigns = [
			{ id: 'student-ai-campaign', name: 'Student AI Campaign' },
			{ id: 'july-fourth-campaign', name: 'July Fourth Campaign' },
			{ id: 'club-free-drinks-campaign', name: 'Club Free Drinks Campaign' }
		],
		selectedCampaignId = null
	}: Props = $props();
</script>

<div class="flex h-full flex-1 flex-col">
	<div class="px-6 pt-6 pb-5 border-b border-gray-100">
		<Button
			href="/chat"
			class="w-full justify-center bg-[#FF6F61] text-white hover:bg-[#ff846f]"
		>
			New Campaign
		</Button>
	</div>

	<div class="px-6 py-5 space-y-3 border-t border-gray-100">
		<p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Campaign</p>
		<div class="space-y-2">
			{#each campaigns as campaign}
				<a
					href={campaign.href ?? `/campaign/${campaign.id}`}
					class={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm transition ${
						selectedCampaignId === campaign.id
							? 'bg-[#FFF1ED] text-gray-900 shadow-sm'
							: 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
					}`}
				>
					<span class="font-medium">{campaign.name}</span>
				</a>
			{/each}
		</div>
	</div>

	<nav class="px-6 py-5 mt-auto border-t border-gray-100 space-y-1">
		{#each navItems as item}
			<a
				href={item.href}
				class="relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-gray-600 transition hover:text-gray-900 hover:bg-gray-50"
			>
				{#if item.icon === 'settings'}
					<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
				{:else if item.icon === 'account'}
					<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
					</svg>
				{:else}
					<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.667 2.667 0 00-.1.661z" />
					</svg>
				{/if}
				<span class="font-medium">{item.label}</span>
				{#if item.badge}
					<span class="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#FF6F61] text-[10px] font-semibold text-white">{item.badge}</span>
				{/if}
			</a>
		{/each}
	</nav>
</div>
