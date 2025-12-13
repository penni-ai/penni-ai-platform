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

let directSend = $state(false);
let outreachSettingsLoading = $state(false);
let outreachSettingsSaving = $state(false);
let outreachSettingsMessage = $state<string | null>(null);

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

async function loadOutreachSettings() {
	if (outreachSettingsLoading) return;
	outreachSettingsLoading = true;
	try {
		const response = await fetch('/api/settings/email');
		if (response.ok) {
			const data = await response.json();
			directSend = data.directSend ?? false;
		}
	} catch (error) {
		console.error('Failed to load outreach settings:', error);
	} finally {
		outreachSettingsLoading = false;
	}
}

async function saveOutreachSettings() {
	if (outreachSettingsSaving) return;
	outreachSettingsSaving = true;
	outreachSettingsMessage = null;
	try {
		const response = await fetch('/api/settings/email', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ directSend })
		});
		if (response.ok) {
			outreachSettingsMessage = 'Outreach settings saved.';
			setTimeout(() => {
				outreachSettingsMessage = null;
			}, 3000);
		} else {
			const error = await response.json();
			outreachSettingsMessage = error.message || 'Failed to save settings.';
		}
	} catch (error) {
		outreachSettingsMessage = 'Failed to save settings.';
		console.error('Failed to save outreach settings:', error);
	} finally {
		outreachSettingsSaving = false;
	}
}

// Load settings on mount
loadOutreachSettings();

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
		<h2 class="text-base font-semibold mb-4" style="color: var(--color-text)">Profile</h2>
		<form
			class="space-y-3"
			onsubmit={(event) => {
				event.preventDefault();
				alert('Demo only');
			}}
		>
			<div>
				<label class="text-xs font-medium mb-1 block" style="color: var(--color-text-secondary)" for="full_name">Full name</label>
				<input id="full_name" name="full_name" bind:value={fullName} class="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1" style="border-color: var(--color-border); color: var(--color-text); --tw-ring-color: var(--color-primary);" onfocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'} onblur={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'} />
			</div>
			<div>
				<label class="text-xs font-medium mb-1 block" style="color: var(--color-text-secondary)" for="account_email">Email</label>
				<input id="account_email" value={data.userEmail ?? ''} readonly class="w-full rounded-md border px-3 py-2 text-sm" style="border-color: var(--color-border); background-color: var(--color-bg-elevated); color: var(--color-text-muted)" />
			</div>
			<div>
				<label class="text-xs font-medium mb-1 block" style="color: var(--color-text-secondary)" for="locale">Locale</label>
				<select id="locale" name="locale" bind:value={locale} class="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1" style="border-color: var(--color-border); color: var(--color-text); --tw-ring-color: var(--color-primary);" onfocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'} onblur={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}>
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

	<div class="border-t pt-6" style="border-color: var(--color-border)">
		<h2 class="text-base font-semibold mb-4" style="color: var(--color-text)">Team preferences</h2>
		<div class="space-y-3 text-sm">
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={shareLists} class="mt-0.5 h-4 w-4 rounded border focus:ring" style="border-color: var(--color-border); color: var(--color-primary); --tw-ring-color: var(--color-primary);" />
				<div>
					<p class="font-medium" style="color: var(--color-text)">Share influencer lists by default</p>
					<p class="text-xs" style="color: var(--color-text-muted)">New matches appear for all collaborators instantly.</p>
				</div>
			</label>
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={allowTemplateEdits} class="mt-0.5 h-4 w-4 rounded border focus:ring" style="border-color: var(--color-border); color: var(--color-primary); --tw-ring-color: var(--color-primary);" />
				<div>
					<p class="font-medium" style="color: var(--color-text)">Allow edits to outreach templates</p>
					<p class="text-xs" style="color: var(--color-text-muted)">Teammates can refine copy before it's sent out.</p>
				</div>
			</label>
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={sendDailyDigest} class="mt-0.5 h-4 w-4 rounded border focus:ring" style="border-color: var(--color-border); color: var(--color-primary); --tw-ring-color: var(--color-primary);" />
				<div>
					<p class="font-medium" style="color: var(--color-text)">Send daily digest</p>
					<p class="text-xs" style="color: var(--color-text-muted)">Recap replies and next steps at 8am local time.</p>
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

	<div class="border-t pt-6" style="border-color: var(--color-border)">
		<h2 class="text-base font-semibold mb-4" style="color: var(--color-text)">Outreach Settings</h2>
		<div class="space-y-3 text-sm">
			<label class="flex items-start gap-2">
				<input
					type="checkbox"
					bind:checked={directSend}
					class="mt-0.5 h-4 w-4 rounded border focus:ring"
					style="border-color: var(--color-border); color: var(--color-primary); --tw-ring-color: var(--color-primary);"
					disabled={outreachSettingsLoading || outreachSettingsSaving}
				/>
				<div>
					<p class="font-medium" style="color: var(--color-text)">Direct Gmail Send</p>
					<p class="text-xs" style="color: var(--color-text-muted)">When enabled, emails will be sent directly instead of creating drafts. This will use your outreach credits.</p>
				</div>
			</label>
		</div>
		<div class="flex items-center gap-3 mt-4">
			<Button
				type="button"
				class="px-4 py-1.5 text-sm"
				onclick={saveOutreachSettings}
				disabled={outreachSettingsSaving || outreachSettingsLoading}
			>
				{outreachSettingsSaving ? 'Saving…' : 'Save outreach settings'}
			</Button>
			{#if outreachSettingsMessage}
				<span class="text-xs font-medium text-emerald-600">{outreachSettingsMessage}</span>
			{/if}
		</div>
	</div>

	<div class="border-t pt-6" style="border-color: var(--color-border)">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h2 class="text-base font-semibold" style="color: var(--color-text)">Usage</h2>
				<p class="text-xs mt-0.5" style="color: var(--color-text-muted)">Recent activity used for billing and performance reporting.</p>
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
					<thead class="text-xs font-medium border-b" style="color: var(--color-text-secondary); border-color: var(--color-border)">
						<tr>
							<th class="px-3 py-2">Metric</th>
							<th class="px-3 py-2">Quantity</th>
							<th class="px-3 py-2">Recorded</th>
						</tr>
					</thead>
					<tbody class="divide-y" style="border-color: var(--color-border)">
						{#each usage as row}
							<tr>
								<td class="px-3 py-2" style="color: var(--color-text)">{row.metric}</td>
								<td class="px-3 py-2" style="color: var(--color-text)">{row.quantity}</td>
								<td class="px-3 py-2" style="color: var(--color-text-secondary)">{formatUsageDate(row.recordedAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm" style="color: var(--color-text-muted)">No usage data yet.</p>
		{/if}
	</div>

	<div class="border-t pt-6" style="border-color: var(--color-border)">
		<h2 class="text-base font-semibold mb-4" style="color: var(--color-text)">Security</h2>
		<form class="space-y-3" onsubmit={handlePasswordChange}>
			{#if passwordError}
				<div class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{passwordError}</div>
			{/if}
			{#if passwordMessage}
				<div class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{passwordMessage}</div>
			{/if}
			<div>
				<label class="text-xs font-medium mb-1 block" style="color: var(--color-text-secondary)" for="current_password">Current password</label>
				<input
					id="current_password"
					type="password"
					required
					minlength="6"
					bind:value={currentPassword}
					class="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1"
					style="border-color: var(--color-border); color: var(--color-text); --tw-ring-color: var(--color-primary);"
					onfocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'}
					onblur={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
				/>
			</div>
			<div>
				<label class="text-xs font-medium mb-1 block" style="color: var(--color-text-secondary)" for="new_password">New password</label>
				<input
					id="new_password"
					type="password"
					required
					minlength="8"
					bind:value={newPassword}
					class="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1"
					style="border-color: var(--color-border); color: var(--color-text); --tw-ring-color: var(--color-primary);"
					onfocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'}
					onblur={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
				/>
			</div>
			<div>
				<label class="text-xs font-medium mb-1 block" style="color: var(--color-text-secondary)" for="confirm_password">Confirm new password</label>
				<input
					id="confirm_password"
					type="password"
					required
					minlength="8"
					bind:value={confirmPassword}
					class="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1"
					style="border-color: var(--color-border); color: var(--color-text); --tw-ring-color: var(--color-primary);"
					onfocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'}
					onblur={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
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

	<div class="border-t pt-6" style="border-color: var(--color-border)">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium" style="color: var(--color-text)">Ready to sign out?</p>
				<p class="text-xs mt-0.5" style="color: var(--color-text-muted)">You can log back in anytime with your email and password.</p>
			</div>
			<Button href="/logout" variant="outline" class="px-4 py-1.5 text-sm border-red-300 text-red-600 hover:bg-red-50">
				Log out
			</Button>
		</div>
	</div>
</section>
