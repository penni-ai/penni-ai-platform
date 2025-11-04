<script lang="ts">
	import Button from '$lib/components/Button.svelte';

	let { data } = $props();

	const metrics = $derived(() => [
		{
			id: 'sent',
			label: 'Sent',
			value: data.metrics.sent,
			icon: 'paper-airplane',
			accent: 'bg-[#FFF1ED] text-[#FF6F61]'
		},
		{
			id: 'opened',
			label: 'Opened',
			value: data.metrics.opened,
			icon: 'mail-open',
			accent: 'bg-[#F3F4F6] text-gray-600'
		},
		{
			id: 'repliedOut',
			label: 'Replied w/OOO',
			value: data.metrics.repliedOut,
			icon: 'reply',
			accent: 'bg-[#EFF6FF] text-[#2563EB]'
		},
		{
			id: 'positive',
			label: 'Positive Reply',
			value: data.metrics.positive,
			icon: 'chat',
			accent: 'bg-[#ECFDF5] text-[#059669]'
		}
	]);

	const rows = $derived(() => data.influencers ?? []);
	let selectedIds = $state<string[]>([]);

	const allSelected = $derived(() => rows().length > 0 && selectedIds.length === rows().length);

	function formatMetricValue(value: number | null) {
		if (value === null || value === undefined) {
			return 'NA';
		}
		return value.toLocaleString();
	}

	function toggleRow(id: string, checked: boolean) {
		selectedIds = checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((value) => value !== id);
	}

	function setAllSelected(checked: boolean) {
		selectedIds = checked ? rows().map((row) => row.id) : [];
	}

	function toggleAll() {
		setAllSelected(!allSelected());
	}

	function rowSelected(id: string) {
		return selectedIds.includes(id);
	}

	function statusLabel(status: 'sent' | 'replied' | null) {
		if (status === 'sent') return 'Sent';
		if (status === 'replied') return 'Replied';
		return '--';
	}

	function statusTone(status: 'sent' | 'replied' | null) {
		if (status === 'sent') {
			return 'bg-emerald-50 text-emerald-600';
		}
		if (status === 'replied') {
			return 'bg-amber-50 text-amber-600';
		}
		return 'bg-gray-100 text-gray-400';
	}
</script>

<svelte:head>
	<title>{data.campaign.name} · Campaign Dashboard</title>
</svelte:head>

<div class="flex h-full flex-col bg-gray-50">
	<header class="border-b border-gray-100 bg-white">
		<div class="flex flex-wrap items-start justify-between gap-4 px-10 py-8">
			<div class="space-y-2">
				<p class="text-sm font-medium uppercase tracking-[0.3em] text-gray-400">Dashboard</p>
				<h1 class="text-3xl font-semibold text-gray-900">{data.campaign.name}</h1>
				<p class="text-sm text-gray-500">{data.campaign.description}</p>
			</div>
			<Button
				variant="outline"
				class="rounded-full border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
				href="javascript:void(0)"
			>
				Export CSV
			</Button>
		</div>
	</header>

	<main class="flex-1 overflow-y-auto px-10 py-8 space-y-8">
		<section class="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
			{#each metrics() as metric}
				<div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
					<div class="flex items-center justify-between">
						<div class={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold ${metric.accent}`}>
							{#if metric.icon === 'paper-airplane'}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0l-3.5-7.5L12 11l3.5.5L12 19z" />
								</svg>
							{:else if metric.icon === 'mail-open'}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l9 5 9-5m-18 0l9-5 9 5m-18 0v8a2 2 0 002 2h14a2 2 0 002-2V8" />
								</svg>
							{:else if metric.icon === 'reply'}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M7 8l-4 4 4 4m0-4h10a4 4 0 010 8h-1" />
								</svg>
							{:else}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16h6a3 3 0 003-3v-5a3 3 0 00-3-3H9a3 3 0 00-3 3v5a3 3 0 003 3zm9 0v1a3 3 0 01-3 3H9a3 3 0 01-3-3v-1" />
								</svg>
							{/if}
						</div>
						<span class="text-xs font-medium uppercase tracking-wide text-gray-400">{metric.label}</span>
					</div>
					<p class="mt-6 text-4xl font-semibold text-gray-900">{formatMetricValue(metric.value)}</p>
				</div>
			{/each}
		</section>

		<section class="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
			<header class="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-8 py-6">
				<div>
					<h2 class="text-2xl font-semibold text-gray-900">{data.profileCount} Profiles Found</h2>
					<p class="text-sm text-gray-500">
						Pick the strongest creators, send outreach, and keep responses flowing — all from this dashboard.
					</p>
				</div>
				<div class="flex items-center gap-6 text-sm text-gray-500">
					<span>Selected {selectedIds.length}</span>
					<button
						type="button"
						class="rounded-full border border-gray-200 px-4 py-2 font-medium text-gray-600 hover:bg-gray-50"
						onclick={toggleAll}
					>
						{allSelected() ? 'Clear selection' : 'Select all'}
					</button>
				</div>
			</header>

			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-100">
					<thead class="bg-gray-50 text-left text-sm font-medium text-gray-500">
						<tr>
							<th class="px-6 py-3">
								<input
									type="checkbox"
									class="h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]"
									checked={allSelected()}
									onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
										setAllSelected(event.currentTarget.checked);
									}}
								/>
							</th>
							<th class="px-6 py-3 font-medium">Influencer name</th>
							<th class="px-6 py-3 font-medium">Username</th>
							<th class="px-6 py-3 font-medium">Location</th>
							<th class="px-6 py-3 font-medium">Followers</th>
							<th class="px-6 py-3 font-medium">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 text-sm text-gray-600">
						{#each rows() as row}
							<tr class="hover:bg-gray-50">
								<td class="px-6 py-4">
									<input
										type="checkbox"
										class="h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]"
										checked={rowSelected(row.id)}
										onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
											toggleRow(row.id, event.currentTarget.checked)
										}
									/>
								</td>
								<td class="px-6 py-4">
									<div class="flex items-center gap-3">
										<span class="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFF1ED] text-sm font-semibold text-[#FF6F61]">
											{row.name.slice(0, 1)}
										</span>
										<span class="font-semibold text-gray-900">{row.name}</span>
									</div>
								</td>
								<td class="px-6 py-4">
									<a href={`https://www.instagram.com/${row.username.replace('@', '')}`} class="text-[#2563EB] hover:underline">
										{row.username}
									</a>
								</td>
								<td class="px-6 py-4">{row.location}</td>
								<td class="px-6 py-4 font-semibold text-gray-900">{row.followers}</td>
								<td class="px-6 py-4">
									<span class={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusTone(row.status)}`}>
										{statusLabel(row.status)}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<footer class="flex flex-col gap-4 border-t border-gray-100 px-8 py-6 md:flex-row md:items-center md:justify-between">
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-full border border-[#FF6F61] px-5 py-3 text-sm font-semibold text-[#FF6F61] hover:bg-[#FFF1ED]"
					onclick={toggleAll}
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5L20 7" />
					</svg>
					Select All Influencers
				</button>
				<div class="flex items-center gap-3">
					<nav class="flex items-center gap-1 text-xs text-gray-500">
						<button type="button" class="h-8 w-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">Prev</button>
						<button type="button" class="h-8 w-8 rounded-full bg-[#FF6F61] text-white">1</button>
						<button type="button" class="h-8 w-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">2</button>
						<button type="button" class="h-8 w-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">3</button>
						<span class="px-2">…</span>
						<button type="button" class="h-8 w-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">10</button>
						<button type="button" class="h-8 w-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">Next</button>
					</nav>
					<Button
						type="button"
						class="rounded-full bg-[#FF6F61] px-5 py-3 text-sm font-semibold text-white hover:bg-[#ff846f] disabled:cursor-not-allowed disabled:opacity-60"
						disabled={selectedIds.length === 0}
					>
						Send All Emails
					</Button>
				</div>
			</footer>
		</section>
	</main>
</div>
