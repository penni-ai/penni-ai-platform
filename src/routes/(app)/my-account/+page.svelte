<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { firebaseAuth } from '$lib/firebase/client';
	import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
	import { FirebaseError } from 'firebase/app';

type SubscriptionInfo = {
	planKey?: string | null;
	status: string;
	currentPeriodEnd?: string | null;
	currentPeriodEndRaw?: number | null;
	trialEnd?: string | null;
	trialEndRaw?: number | null;
	cancelAtPeriodEnd?: boolean;
};

type UsageRow = {
	metric: string;
	quantity: number;
	recordedAt: string;
};

let { data } = $props();
const subscription = (data.subscription ?? null) as SubscriptionInfo | null;
const usage = (data.usage ?? []) as UsageRow[];
let fullName = $state(data.profile?.full_name ?? '');
let locale = $state(data.profile?.locale ?? 'en');
let billingError = $state<string | null>(null);
let billingLoading = $state(false);
const subscriptionStatus = $derived(() => subscription?.status ?? null);
const cancelAtPeriodEnd = $derived(() => subscription?.cancelAtPeriodEnd ?? false);
const trialEndsAt = $derived(() => subscription?.trialEnd ?? null);
const renewsAt = $derived(() => subscription?.currentPeriodEnd ?? null);
const nextInvoiceLabel = $derived(() => {
	const targetDate = renewsAt() ?? trialEndsAt();
	if (!targetDate) return '—';
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(targetDate));
});
const planName = $derived(() => {
	const key = subscription?.planKey ?? null;
	switch (key) {
		case 'starter':
			return 'Starter';
		case 'growth':
			return 'Growth';
		case 'event':
			return 'Event add-on';
		default:
			return key ?? 'Free';
	}
});
const subscriptionStatusLabel = $derived(() => {
	const status = subscriptionStatus();
	if (!status) return 'None';
	return status.replace(/_/g, ' ');
});
const subscriptionMessage = $derived(() => {
	const status = subscriptionStatus();
	const cancelScheduled = cancelAtPeriodEnd();
	if (!status) return null;
	const formatDate = (iso: string | null) =>
		iso
			? new Intl.DateTimeFormat(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			}).format(new Date(iso))
			: null;
	switch (status) {
		case 'trialing':
			if (cancelScheduled) {
				return formatDate(trialEndsAt())
					? `Trial ends on ${formatDate(trialEndsAt())}. Subscription will not renew.`
					: 'Trial will end without renewal.';
			}
			return formatDate(trialEndsAt())
				? `Free trial active. Renews on ${formatDate(trialEndsAt())}.`
				: 'Free trial active.';
		case 'active':
			if (cancelScheduled) {
				return formatDate(renewsAt())
					? `Cancellation scheduled. Access continues until ${formatDate(renewsAt())}.`
					: 'Cancellation scheduled at the end of the current period.';
			}
			return formatDate(renewsAt())
				? `Renews automatically on ${formatDate(renewsAt())}.`
				: 'Subscription active.';
		case 'past_due':
			return 'Payment overdue. Update your billing details to avoid interruption.';
		case 'canceled':
			return 'Subscription canceled.';
		default:
			return status.replace('_', ' ');
	}
});

let shareLists = $state(true);
let allowTemplateEdits = $state(false);
let sendDailyDigest = $state(true);
let preferencesSaving = $state(false);
let preferencesMessage = $state<string | null>(null);

const hasUsage = $derived(() => usage.length > 0);

function formatUsageDate(iso: string) {
	return new Date(iso).toLocaleString();
}

function savePreferences() {
	if (preferencesSaving) return;
	preferencesSaving = true;
	preferencesMessage = null;
	setTimeout(() => {
		preferencesSaving = false;
		preferencesMessage = 'Preferences saved (demo only).';
	}, 600);
}
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordLoading = $state(false);
	let passwordError = $state<string | null>(null);
	let passwordMessage = $state<string | null>(null);

async function openBillingPortal() {
	if (billingLoading) return;
	billingError = null;
	billingLoading = true;
	try {
		const response = await fetch('/api/billing/portal', {
			method: 'POST'
		});

		if (response.status === 401) {
			window.location.href = `/sign-in?redirectTo=${encodeURIComponent('/my-account')}`;
			return;
		}

		const payload = await response.json();
		if (!response.ok || !payload?.url) {
			throw new Error(payload?.error ?? 'Unable to open billing portal.');
		}

		window.location.href = payload.url;
	} catch (error) {
		billingError = error instanceof Error ? error.message : 'Unable to open billing portal right now.';
	} finally {
		billingLoading = false;
	}
}

	async function handlePasswordChange(event: SubmitEvent) {
		event.preventDefault();
		if (passwordLoading) return;

		passwordError = null;
		passwordMessage = null;

		if (!newPassword || newPassword.length < 8) {
			passwordError = 'New password must be at least 8 characters.';
			return;
		}

		if (newPassword !== confirmPassword) {
			passwordError = 'New passwords do not match.';
			return;
		}

		const user = firebaseAuth.currentUser;
		if (!user || !user.email) {
			passwordError = 'You must be signed in to update your password.';
			return;
		}

		passwordLoading = true;
		try {
			const credential = EmailAuthProvider.credential(user.email, currentPassword);
			await reauthenticateWithCredential(user, credential);
			await updatePassword(user, newPassword);

			const idToken = await user.getIdToken(true);
		const response = await fetch('/api/public/session', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ idToken, remember: true })
		});

		if (!response.ok) {
			const payload = await response.json().catch(() => ({}));
			const code = typeof payload?.error?.code === 'string' ? payload.error.code : null;
			const message =
				typeof payload?.error?.message === 'string'
					? payload.error.message
					: 'Unable to refresh your session after updating the password.';
			const combined = code ? `${code}: ${message}` : message;
			throw new Error(combined);
		}

			passwordMessage = 'Password updated successfully.';
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch (error) {
			if (error instanceof FirebaseError) {
				switch (error.code) {
					case 'auth/wrong-password':
						passwordError = 'Current password is incorrect.';
						break;
					case 'auth/weak-password':
						passwordError = 'Choose a stronger password (at least 6 characters).';
						break;
					case 'auth/too-many-requests':
						passwordError = 'Too many attempts. Please try again later.';
						break;
					case 'auth/requires-recent-login':
						passwordError = 'Please sign in again before changing your password.';
						break;
					default:
						passwordError = error.message;
				}
			} else if (error instanceof Error) {
				passwordError = error.message;
			} else {
				passwordError = 'Unable to update password right now.';
			}
		} finally {
			passwordLoading = false;
		}
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
			<p><span class="text-gray-500">Plan:</span> {planName()}</p>
			<p><span class="text-gray-500">Status:</span> {subscriptionStatusLabel()}</p>
			<p><span class="text-gray-500">Next invoice:</span> {nextInvoiceLabel()}</p>
		</div>
		{#if subscriptionMessage()}
			<div class="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
				{subscriptionMessage()}
			</div>
		{/if}
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
		<article class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:col-span-2">
			<h2 class="text-lg font-semibold text-gray-900">Team preferences</h2>
			<p class="mt-2 text-sm text-gray-500">Control collaboration defaults for teammates helping on campaigns.</p>
			<div class="mt-5 space-y-4 text-sm text-gray-700">
				<label class="flex items-start gap-3">
					<input type="checkbox" bind:checked={shareLists} class="mt-1 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
					<div>
						<p class="font-medium text-gray-900">Share influencer lists by default</p>
						<p class="text-xs text-gray-500">New matches appear for all collaborators instantly.</p>
					</div>
				</label>
				<label class="flex items-start gap-3">
					<input type="checkbox" bind:checked={allowTemplateEdits} class="mt-1 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
					<div>
						<p class="font-medium text-gray-900">Allow edits to outreach templates</p>
						<p class="text-xs text-gray-500">Teammates can refine copy before it’s sent out.</p>
					</div>
				</label>
				<label class="flex items-start gap-3">
					<input type="checkbox" bind:checked={sendDailyDigest} class="mt-1 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
					<div>
						<p class="font-medium text-gray-900">Send daily digest</p>
						<p class="text-xs text-gray-500">Recap replies and next steps at 8am local time.</p>
					</div>
				</label>
			</div>
			<div class="mt-6 flex flex-wrap items-center gap-3">
				<Button type="button" class="px-5" onclick={savePreferences} disabled={preferencesSaving}>
					{preferencesSaving ? 'Saving…' : 'Save preferences'}
				</Button>
				{#if preferencesMessage}
					<span class="text-xs font-medium text-emerald-600">{preferencesMessage}</span>
				{/if}
			</div>
		</article>
		<article class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:col-span-2">
			<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-gray-900">Usage</h2>
					<p class="text-sm text-gray-500">Recent activity used for billing and performance reporting.</p>
				</div>
				<Button
					type="button"
					variant="outline"
					class="px-5"
					onclick={() => alert('Export not available in this demo')}
				>
					Export CSV
				</Button>
			</div>
			{#if hasUsage()}
				<div class="mt-4 overflow-x-auto">
					<table class="min-w-full text-left text-sm text-gray-700">
						<thead class="text-xs uppercase tracking-wide text-gray-500">
							<tr>
								<th class="px-4 py-2">Metric</th>
								<th class="px-4 py-2">Quantity</th>
								<th class="px-4 py-2">Recorded</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100">
							{#each usage as row}
								<tr>
									<td class="px-4 py-2">{row.metric}</td>
									<td class="px-4 py-2">{row.quantity}</td>
									<td class="px-4 py-2">{formatUsageDate(row.recordedAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="mt-4 text-sm text-gray-500">No usage data yet.</p>
			{/if}
		</article>
		<article class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:col-span-2">
			<h2 class="text-lg font-semibold text-gray-900">Security</h2>
			<p class="mt-2 text-sm text-gray-500">Change your password to keep your account secure.</p>
			<form class="mt-6 space-y-4" onsubmit={handlePasswordChange}>
					{#if passwordError}
						<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordError}</div>
					{/if}
					{#if passwordMessage}
						<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{passwordMessage}</div>
					{/if}
					<div>
						<label class="text-xs font-semibold uppercase tracking-wide text-gray-400" for="current_password">Current password</label>
						<input
							id="current_password"
							type="password"
							required
							minlength="6"
							bind:value={currentPassword}
							class="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						/>
					</div>
					<div>
						<label class="text-xs font-semibold uppercase tracking-wide text-gray-400" for="new_password">New password</label>
						<input
							id="new_password"
							type="password"
							required
							minlength="8"
							bind:value={newPassword}
							class="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						/>
					</div>
					<div>
						<label class="text-xs font-semibold uppercase tracking-wide text-gray-400" for="confirm_password">Confirm new password</label>
						<input
							id="confirm_password"
							type="password"
							required
							minlength="8"
							bind:value={confirmPassword}
							class="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						/>
					</div>
					<div class="flex justify-end">
						<Button
							type="submit"
							class="px-5"
							disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
						>
							{passwordLoading ? 'Updating…' : 'Update password'}
						</Button>
					</div>
				</form>
			</article>
		</section>
	</main>
</div>
