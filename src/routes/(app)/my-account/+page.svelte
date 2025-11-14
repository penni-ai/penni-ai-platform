<script lang="ts">
import Button from '$lib/components/Button.svelte';
import { firebaseAuth } from '$lib/firebase/client';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

type UsageRow = {
	metric: string;
	quantity: number;
	recordedAt: string;
};

let { data } = $props();
const usage = (data.usage ?? []) as UsageRow[];
let fullName = $state(data.profile?.full_name ?? '');
let locale = $state(data.profile?.locale ?? 'en');

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

<section class="flex flex-col gap-8">
	<div>
		<h2 class="text-base font-semibold text-gray-900 mb-4">Profile</h2>
		<form
			class="space-y-3"
			onsubmit={(event) => {
				event.preventDefault();
				alert('Demo only');
			}}
		>
			<div>
				<label class="text-xs font-medium text-gray-700 mb-1 block" for="full_name">Full name</label>
				<input id="full_name" name="full_name" bind:value={fullName} class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]" />
			</div>
			<div>
				<label class="text-xs font-medium text-gray-700 mb-1 block" for="account_email">Email</label>
				<input id="account_email" value={data.userEmail ?? ''} readonly class="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
			</div>
			<div>
				<label class="text-xs font-medium text-gray-700 mb-1 block" for="locale">Locale</label>
				<select id="locale" name="locale" bind:value={locale} class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]">
					<option value="en">English</option>
					<option value="id">Bahasa Indonesia</option>
					<option value="es">Spanish</option>
				</select>
			</div>
			<div class="flex justify-end pt-2">
				<Button type="submit" class="px-4 py-1.5 text-sm">Save changes</Button>
			</div>
		</form>
	</div>

	<div class="border-t border-gray-200 pt-6">
		<h2 class="text-base font-semibold text-gray-900 mb-4">Team preferences</h2>
		<div class="space-y-3 text-sm">
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={shareLists} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
				<div>
					<p class="font-medium text-gray-900">Share influencer lists by default</p>
					<p class="text-xs text-gray-500">New matches appear for all collaborators instantly.</p>
				</div>
			</label>
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={allowTemplateEdits} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
				<div>
					<p class="font-medium text-gray-900">Allow edits to outreach templates</p>
					<p class="text-xs text-gray-500">Teammates can refine copy before it's sent out.</p>
				</div>
			</label>
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={sendDailyDigest} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
				<div>
					<p class="font-medium text-gray-900">Send daily digest</p>
					<p class="text-xs text-gray-500">Recap replies and next steps at 8am local time.</p>
				</div>
			</label>
		</div>
		<div class="flex items-center gap-3 mt-4">
			<Button type="button" class="px-4 py-1.5 text-sm" onclick={savePreferences} disabled={preferencesSaving}>
				{preferencesSaving ? 'Saving…' : 'Save preferences'}
			</Button>
			{#if preferencesMessage}
				<span class="text-xs font-medium text-emerald-600">{preferencesMessage}</span>
			{/if}
		</div>
	</div>

	<div class="border-t border-gray-200 pt-6">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h2 class="text-base font-semibold text-gray-900">Usage</h2>
				<p class="text-xs text-gray-500 mt-0.5">Recent activity used for billing and performance reporting.</p>
			</div>
			<Button
				type="button"
				variant="outline"
				class="px-4 py-1.5 text-sm"
				onclick={() => alert('Export not available in this demo')}
			>
				Export CSV
			</Button>
		</div>
		{#if hasUsage()}
			<div class="overflow-x-auto">
				<table class="min-w-full text-left text-sm">
					<thead class="text-xs font-medium text-gray-500 border-b border-gray-200">
						<tr>
							<th class="px-3 py-2">Metric</th>
							<th class="px-3 py-2">Quantity</th>
							<th class="px-3 py-2">Recorded</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each usage as row}
							<tr>
								<td class="px-3 py-2 text-gray-900">{row.metric}</td>
								<td class="px-3 py-2 text-gray-900">{row.quantity}</td>
								<td class="px-3 py-2 text-gray-600">{formatUsageDate(row.recordedAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-gray-500">No usage data yet.</p>
		{/if}
	</div>

	<div class="border-t border-gray-200 pt-6">
		<h2 class="text-base font-semibold text-gray-900 mb-4">Security</h2>
		<form class="space-y-3" onsubmit={handlePasswordChange}>
			{#if passwordError}
				<div class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{passwordError}</div>
			{/if}
			{#if passwordMessage}
				<div class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{passwordMessage}</div>
			{/if}
			<div>
				<label class="text-xs font-medium text-gray-700 mb-1 block" for="current_password">Current password</label>
				<input
					id="current_password"
					type="password"
					required
					minlength="6"
					bind:value={currentPassword}
					class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
				/>
			</div>
			<div>
				<label class="text-xs font-medium text-gray-700 mb-1 block" for="new_password">New password</label>
				<input
					id="new_password"
					type="password"
					required
					minlength="8"
					bind:value={newPassword}
					class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
				/>
			</div>
			<div>
				<label class="text-xs font-medium text-gray-700 mb-1 block" for="confirm_password">Confirm new password</label>
				<input
					id="confirm_password"
					type="password"
					required
					minlength="8"
					bind:value={confirmPassword}
					class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
				/>
			</div>
			<div class="flex justify-end pt-2">
				<Button
					type="submit"
					class="px-4 py-1.5 text-sm"
					disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
				>
					{passwordLoading ? 'Updating…' : 'Update password'}
				</Button>
			</div>
		</form>
	</div>

	<div class="border-t border-gray-200 pt-6">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium text-gray-900">Ready to sign out?</p>
				<p class="text-xs text-gray-500 mt-0.5">You can log back in anytime with your email and password.</p>
			</div>
			<Button href="/logout" variant="outline" class="px-4 py-1.5 text-sm border-red-300 text-red-600 hover:bg-red-50">
				Log out
			</Button>
		</div>
	</div>
</section>
