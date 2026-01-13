<script lang="ts">
import ThemeToggle from '$lib/components/ThemeToggle.svelte';
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

let directSend = $state(false);
let outreachSettingsLoading = $state(false);
let outreachSettingsSaving = $state(false);
let outreachSettingsMessage = $state<string | null>(null);

const hasUsage = $derived(() => usage.length > 0);

function formatUsageDate(iso: string) {
	return new Date(iso).toLocaleString();
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

let accountDeleteLoading = $state(false);
let accountDeleteError = $state<string | null>(null);
let accountDeleteMessage = $state<string | null>(null);

async function requestAccountDeletion() {
	if (accountDeleteLoading) return;
	accountDeleteError = null;
	accountDeleteMessage = null;

	const confirmation = prompt('Type DELETE to request account deletion.');
	if (confirmation !== 'DELETE') {
		return;
	}

	accountDeleteLoading = true;
	try {
		const response = await fetch('/api/user/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: 'DELETE' })
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const message = payload?.error?.message || 'Failed to request account deletion.';
			throw new Error(message);
		}
		accountDeleteMessage =
			payload?.status === 'completed'
				? 'Account data deleted (emulator).'
				: 'Deletion request submitted. We will complete deletion via support/ops process.';
	} catch (error) {
		accountDeleteError = error instanceof Error ? error.message : 'Failed to request account deletion.';
	} finally {
		accountDeleteLoading = false;
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

<div class="settings-page">
	<!-- Page Header -->
	<header class="page-header">
		<div class="header-content">
			<h1 class="page-title">Account Settings</h1>
			<p class="page-subtitle">Manage your profile, security, and preferences</p>
		</div>
	</header>

	<!-- Main Content Grid -->
	<div class="settings-grid">
		<!-- Left Column -->
		<div class="settings-column">
			<!-- Profile Section -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Profile</h2>
						<p class="card-description">Your personal information</p>
					</div>
				</div>

				<form
					class="card-content"
					onsubmit={(event) => {
						event.preventDefault();
						alert('Demo only');
					}}
				>
					<div class="form-group">
						<label class="form-label" for="full_name">Full name</label>
						<input
							id="full_name"
							name="full_name"
							bind:value={fullName}
							class="form-input"
							placeholder="Enter your name"
						/>
					</div>

					<div class="form-group">
						<label class="form-label" for="account_email">Email address</label>
						<input
							id="account_email"
							value={data.userEmail ?? ''}
							readonly
							class="form-input form-input-readonly"
						/>
						<span class="form-hint">Email cannot be changed</span>
					</div>

					<div class="form-group">
						<label class="form-label" for="locale">Language</label>
						<select id="locale" name="locale" bind:value={locale} class="form-input form-select">
							<option value="en">English</option>
							<option value="id">Bahasa Indonesia</option>
							<option value="es">Spanish</option>
						</select>
					</div>

					<div class="card-actions">
						<button type="submit" class="btn btn-primary">Save changes</button>
					</div>
				</form>
			</section>

			<!-- Security Section -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Security</h2>
						<p class="card-description">Update your password</p>
					</div>
				</div>

				<form class="card-content" onsubmit={handlePasswordChange}>
					{#if passwordError}
						<div class="alert alert-error">{passwordError}</div>
					{/if}
					{#if passwordMessage}
						<div class="alert alert-success">{passwordMessage}</div>
					{/if}

					<div class="form-group">
						<label class="form-label" for="current_password">Current password</label>
						<input
							id="current_password"
							type="password"
							required
							minlength="6"
							bind:value={currentPassword}
							class="form-input"
							placeholder="Enter current password"
						/>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="new_password">New password</label>
							<input
								id="new_password"
								type="password"
								required
								minlength="8"
								bind:value={newPassword}
								class="form-input"
								placeholder="At least 8 characters"
							/>
						</div>

						<div class="form-group">
							<label class="form-label" for="confirm_password">Confirm password</label>
							<input
								id="confirm_password"
								type="password"
								required
								minlength="8"
								bind:value={confirmPassword}
								class="form-input"
								placeholder="Repeat new password"
							/>
						</div>
					</div>

					<div class="card-actions">
						<button
							type="submit"
							class="btn btn-primary"
							disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
						>
							{passwordLoading ? 'Updating...' : 'Update password'}
						</button>
					</div>
				</form>
			</section>

			<!-- Usage Section -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Usage</h2>
						<p class="card-description">Recent activity for billing</p>
					</div>
					<button type="button" class="btn btn-text" onclick={() => alert('Export not available in this demo')}>
						Export CSV
					</button>
				</div>

				<div class="card-content">
					{#if hasUsage()}
						<div class="usage-table-wrapper">
							<table class="usage-table">
								<thead>
									<tr>
										<th>Metric</th>
										<th>Quantity</th>
										<th>Recorded</th>
									</tr>
								</thead>
								<tbody>
									{#each usage as row}
										<tr>
											<td>{row.metric}</td>
											<td class="usage-quantity">{row.quantity}</td>
											<td class="usage-date">{formatUsageDate(row.recordedAt)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<p class="empty-state">No usage data yet.</p>
					{/if}
				</div>
			</section>
		</div>

		<!-- Right Column -->
		<div class="settings-column">
			<!-- Outreach Settings Section -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Outreach</h2>
						<p class="card-description">Email sending preferences</p>
					</div>
				</div>

				<div class="card-content">
					<div class="toggle-list">
						<label class="toggle-item">
							<div class="toggle-content">
								<span class="toggle-name">Direct Gmail Send</span>
								<span class="toggle-description">When enabled, emails will be sent directly instead of creating drafts. This will use your outreach credits.</span>
							</div>
							<div class="toggle-switch-wrapper">
								<input
									type="checkbox"
									bind:checked={directSend}
									class="toggle-checkbox"
									disabled={outreachSettingsLoading || outreachSettingsSaving}
								/>
								<span class="toggle-switch"></span>
							</div>
						</label>
					</div>

					<div class="card-actions">
						<button
							type="button"
							class="btn btn-primary"
							onclick={saveOutreachSettings}
							disabled={outreachSettingsSaving || outreachSettingsLoading}
						>
							{outreachSettingsSaving ? 'Saving...' : 'Save outreach settings'}
						</button>
						{#if outreachSettingsMessage}
							<span class="success-message">{outreachSettingsMessage}</span>
						{/if}
					</div>
				</div>
			</section>

			<!-- Appearance Section -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Appearance</h2>
						<p class="card-description">Choose your color scheme</p>
					</div>
				</div>

				<div class="card-content">
					<ThemeToggle />
				</div>
			</section>

			<!-- Sign Out Section -->
			<section class="settings-card settings-card-danger">
				<div class="card-header">
					<div class="card-icon card-icon-danger">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Sign Out</h2>
						<p class="card-description">Log out of your account</p>
					</div>
					<a href="/logout" class="btn btn-danger">Log out</a>
				</div>
			</section>

			<!-- Account Deletion -->
			<section class="settings-card settings-card-danger">
				<div class="card-header">
					<div class="card-icon card-icon-danger">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Delete Account</h2>
						<p class="card-description">Request deletion of your account data</p>
					</div>
					<button type="button" class="btn btn-danger" onclick={requestAccountDeletion} disabled={accountDeleteLoading}>
						{accountDeleteLoading ? 'Requesting…' : 'Request deletion'}
					</button>
				</div>
				<div class="card-content">
					<p class="form-hint">
						This will disconnect connected Gmail accounts and stop queued sends. Deletion requests are processed via support/ops.
					</p>
					{#if accountDeleteError}
						<div class="alert alert-error">{accountDeleteError}</div>
					{/if}
					{#if accountDeleteMessage}
						<div class="alert alert-success">{accountDeleteMessage}</div>
					{/if}
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	.settings-page {
		--coral: #FF6F61;
		--coral-dark: #e85d50;
		--ink: var(--color-text, #1a1a1a);
		--ink-light: var(--color-text-secondary, #4a4a4a);
		--ink-muted: var(--color-text-muted, #8a8a8a);
		--paper: var(--color-bg, #fafaf9);
		--paper-elevated: var(--color-bg-elevated, #ffffff);
		--border: var(--color-border, #e8e6e3);
		--success: #059669;
		--error: #dc2626;

		font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
	}

	/* Page Header */
	.page-header {
		margin-bottom: 2rem;
	}

	.header-content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.page-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2.5rem;
		font-weight: 400;
		color: var(--ink);
		line-height: 1.1;
		margin: 0;
	}

	.page-subtitle {
		font-size: 1rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Settings Grid */
	.settings-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	.settings-column {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Settings Card */
	.settings-card {
		background: var(--paper-elevated);
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}

	.settings-card-danger {
		border-color: #fecaca;
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.settings-card-danger .card-header {
		border-bottom-color: #fecaca;
		background: #fef2f2;
	}

	.card-icon {
		width: 40px;
		height: 40px;
		background: var(--paper);
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.card-icon svg {
		width: 20px;
		height: 20px;
		color: var(--ink-muted);
	}

	.card-icon-danger {
		background: #fee2e2;
	}

	.card-icon-danger svg {
		color: var(--error);
	}

	.card-header > div:not(.card-icon) {
		flex: 1;
		min-width: 0;
	}

	.card-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 0.25rem 0;
	}

	.card-description {
		font-size: 0.875rem;
		color: var(--ink-muted);
		margin: 0;
	}

	.card-content {
		padding: 1.5rem;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border);
	}

	/* Form Elements */
	.form-group {
		margin-bottom: 1.25rem;
	}

	.form-group:last-of-type {
		margin-bottom: 0;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.form-row .form-group {
		margin-bottom: 0;
	}

	.form-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.form-input {
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 0.9375rem;
		font-family: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 1px solid var(--border);
		border-radius: 8px;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
	}

	.form-input::placeholder {
		color: var(--ink-muted);
	}

	.form-input:focus {
		outline: none;
		border-color: var(--coral);
		box-shadow: 0 0 0 3px rgba(255, 111, 97, 0.1);
	}

	.form-input-readonly {
		color: var(--ink-muted);
		cursor: not-allowed;
		background: var(--border);
	}

	.form-select {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 1rem center;
		padding-right: 2.5rem;
		cursor: pointer;
	}

	.form-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--ink-muted);
		margin-top: 0.5rem;
		font-style: italic;
	}

	/* Toggle List */
	.toggle-list {
		display: flex;
		flex-direction: column;
	}

	.toggle-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		transition: opacity 0.15s ease;
	}

	.toggle-item:first-child {
		padding-top: 0;
	}

	.toggle-item:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.toggle-item:hover {
		opacity: 0.85;
	}

	.toggle-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.toggle-name {
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--ink);
		line-height: 1.4;
	}

	.toggle-description {
		font-size: 0.8125rem;
		color: var(--ink-muted);
		line-height: 1.5;
	}

	/* Toggle Switch */
	.toggle-switch-wrapper {
		position: relative;
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.toggle-checkbox {
		position: absolute;
		opacity: 0;
		width: 44px;
		height: 24px;
		cursor: pointer;
		z-index: 1;
	}

	.toggle-switch {
		display: block;
		width: 44px;
		height: 24px;
		background: var(--border);
		border-radius: 12px;
		transition: background 0.2s ease;
		position: relative;
	}

	.toggle-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		background: white;
		border-radius: 50%;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
		transition: transform 0.2s ease;
	}

	.toggle-checkbox:checked + .toggle-switch {
		background: var(--coral);
	}

	.toggle-checkbox:checked + .toggle-switch::after {
		transform: translateX(20px);
	}

	.toggle-checkbox:focus + .toggle-switch {
		box-shadow: 0 0 0 3px rgba(255, 111, 97, 0.2);
	}

	.toggle-checkbox:disabled + .toggle-switch {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem 1.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		font-family: inherit;
		text-decoration: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-primary {
		background: var(--coral);
		color: white;
		border: none;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--coral-dark);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-danger {
		background: transparent;
		color: var(--error);
		border: 1px solid #fca5a5;
	}

	.btn-danger:hover {
		background: #fef2f2;
		border-color: var(--error);
	}

	.btn-text {
		padding: 0.5rem 0.75rem;
		background: none;
		color: var(--coral);
		border: none;
		margin-left: auto;
	}

	.btn-text:hover {
		text-decoration: underline;
	}

	/* Alerts */
	.alert {
		padding: 0.875rem 1rem;
		font-size: 0.875rem;
		line-height: 1.5;
		border-radius: 8px;
		margin-bottom: 1rem;
	}

	.alert-error {
		background: #fef2f2;
		color: var(--error);
		border: 1px solid #fecaca;
	}

	.alert-success {
		background: #ecfdf5;
		color: var(--success);
		border: 1px solid #a7f3d0;
	}

	.success-message {
		font-size: 0.875rem;
		color: var(--success);
		font-weight: 500;
	}

	/* Usage Table */
	.usage-table-wrapper {
		overflow-x: auto;
		margin: -0.5rem;
		padding: 0.5rem;
	}

	.usage-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.usage-table thead th {
		text-align: left;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-muted);
		font-weight: 600;
		padding: 0 1rem 0.75rem 0;
		border-bottom: 1px solid var(--border);
	}

	.usage-table tbody td {
		padding: 0.875rem 1rem 0.875rem 0;
		color: var(--ink);
		border-bottom: 1px solid var(--border);
	}

	.usage-table tbody tr:last-child td {
		border-bottom: none;
	}

	.usage-quantity {
		font-weight: 600;
		color: var(--coral);
	}

	.usage-date {
		color: var(--ink-muted);
		font-size: 0.8125rem;
	}

	.empty-state {
		font-size: 0.9375rem;
		color: var(--ink-muted);
		font-style: italic;
		margin: 0;
		text-align: center;
		padding: 1rem 0;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.settings-grid {
			grid-template-columns: 1fr;
		}

		.page-title {
			font-size: 2rem;
		}
	}

	@media (max-width: 640px) {
		.page-title {
			font-size: 1.75rem;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.card-header {
			padding: 1rem 1.25rem;
		}

		.card-content {
			padding: 1.25rem;
		}

		.toggle-item {
			flex-direction: column;
			gap: 0.75rem;
		}

		.card-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.btn {
			width: 100%;
		}
	}
</style>
