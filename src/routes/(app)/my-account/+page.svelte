<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Logo from '$lib/components/Logo.svelte';

	type SubscriptionInfo = {
		type: string;
		status: string;
		currentPeriodEnd?: string | null;
	};

	let { data } = $props();
	const subscription = (data.subscription ?? null) as SubscriptionInfo | null;
	let fullName = $state(data.profile?.full_name ?? '');
	let locale = $state(data.profile?.locale ?? 'en');
	let billingError = $state<string | null>(null);
	let billingLoading = $state(false);

	function openBillingPortal() {
		billingError = null;
		billingLoading = true;
		setTimeout(() => {
			billingLoading = false;
			billingError = 'Billing portal is unavailable in this demo.';
		}, 600);
	}
</script>

<div class="min-h-screen bg-gray-50">
	<header class="border-b border-gray-200 bg-white">
		<div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-8 py-6">
			<a class="flex items-center gap-3 text-gray-600 transition hover:text-gray-900" href="/dashboard">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				<span class="text-sm font-medium">Back to dashboard</span>
			</a>
			<Logo size="md" />
		</div>
	</header>

	<main class="mx-auto flex max-w-6xl flex-col gap-10 px-8 py-12">
		<section class="flex flex-col gap-3">
			<h1 class="text-3xl font-semibold text-gray-900">My account</h1>
			<p class="text-sm text-gray-500">Manage your identity, language preferences, and billing details.</p>
		</section>

		<section class="grid gap-6 md:grid-cols-2">
			<article class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
				<h2 class="text-lg font-semibold text-gray-900">Profile</h2>
				<p class="mt-2 text-sm text-gray-500">Update how collaborators see you inside the dashboard.</p>
				<form
					class="mt-6 space-y-4"
					onsubmit={(event) => {
						event.preventDefault();
						alert('Demo only');
					}}
				>
					<div>
						<label class="text-xs font-semibold uppercase tracking-wide text-gray-400" for="full_name">Full name</label>
						<input id="full_name" name="full_name" bind:value={fullName} class="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]" />
					</div>
					<div>
						<label class="text-xs font-semibold uppercase tracking-wide text-gray-400" for="account_email">Email</label>
						<input id="account_email" value={data.userEmail ?? ''} readonly class="mt-1 w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-500" />
					</div>
					<div>
						<label class="text-xs font-semibold uppercase tracking-wide text-gray-400" for="locale">Locale</label>
						<select id="locale" name="locale" bind:value={locale} class="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]">
							<option value="en">English</option>
							<option value="id">Bahasa Indonesia</option>
							<option value="es">Spanish</option>
						</select>
					</div>
					<div class="flex justify-end">
						<Button type="submit" class="px-5">Save changes</Button>
					</div>
				</form>

				<div class="mt-8 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="text-sm font-semibold text-gray-900">Ready to sign out?</p>
							<p class="text-xs text-gray-500">You can log back in anytime with your email and password.</p>
						</div>
						<Button href="/logout" variant="outline" class="border-red-300 text-red-600 hover:bg-red-50">
							Log out
						</Button>
					</div>
				</div>
			</article>
			<article class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
				<h2 class="text-lg font-semibold text-gray-900">Billing</h2>
				<p class="mt-2 text-sm text-gray-500">Status of your current subscription.</p>
				<div class="mt-5 space-y-3 text-sm text-gray-700">
					<p><span class="text-gray-500">Plan:</span> {subscription?.type ?? 'Free'}</p>
					<p><span class="text-gray-500">Status:</span> {subscription?.status ?? 'active'}</p>
					<p><span class="text-gray-500">Next invoice:</span> {subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : '—'}</p>
				</div>
				<div class="mt-6 flex gap-3">
					<Button variant="outline" class="px-5" href="/pricing">View plans</Button>
					<Button class="px-5" onclick={openBillingPortal} disabled={billingLoading}>
						{billingLoading ? 'Opening…' : 'Manage billing'}
					</Button>
				</div>
				{#if billingError}
					<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{billingError}
					</div>
				{/if}
			</article>
		</section>
	</main>
</div>
