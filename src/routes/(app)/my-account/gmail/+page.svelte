<script lang="ts">
import { onMount } from 'svelte';

interface GmailConnectionView {
	id: string;
	email: string;
	connectedAt: number | null;
	lastRefreshedAt: number | null;
	accountType?: 'draft' | 'send';
}

let gmailConnections = $state<GmailConnectionView[]>([]);
let gmailError = $state<string | null>(null);
let gmailMessage = $state<string | null>(null);
let gmailDisconnectingId = $state<string | null>(null);
let gmailReconnectId = $state<string | null>(null);
let openMenuId = $state<string | null>(null);
let menuButtonRefs = $state<Map<string, HTMLElement>>(new Map());
let menuPosition = $state<{ top: number; right: number } | null>(null);
let showAccountTypeModal = $state(false);
let selectedAccountType = $state<'draft' | 'send'>('send');

function formatGmailTimestamp(value: number | null): string | null {
	if (!value) return null;
	return new Date(value).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

function formatGmailCallbackError(code: string, fallback?: string | null) {
	switch (code) {
		case 'token_exchange':
			return fallback || 'We could not finish connecting to Gmail. Remove Penny from your Google Account permissions and try again.';
		case 'missing_code':
			return 'Google did not return an authorization code. Please try reconnecting.';
		case 'invalid_state':
			return 'Security check failed. Refresh the page and try again.';
		default:
			return fallback || 'Failed to connect Gmail. Please try again.';
	}
}

onMount(() => {
	checkGmailStatus();
	if (typeof window === 'undefined') return;
	const currentUrl = new URL(window.location.href);
	const errorCode = currentUrl.searchParams.get('gmail_error');
	const callbackMessage = currentUrl.searchParams.get('message');
	const connected = currentUrl.searchParams.get('gmail_connected');
	let shouldCleanParams = false;
	if (errorCode) {
		gmailError = formatGmailCallbackError(errorCode, callbackMessage);
		shouldCleanParams = true;
	} else if (connected) {
		gmailMessage = 'Gmail account connected successfully.';
		shouldCleanParams = true;
	}
	if (shouldCleanParams) {
		currentUrl.searchParams.delete('gmail_error');
		currentUrl.searchParams.delete('message');
		currentUrl.searchParams.delete('gmail_connected');
		const next = `${currentUrl.pathname}${currentUrl.search ? currentUrl.search : ''}${currentUrl.hash}`;
		window.history.replaceState({}, '', next);
	}

	function handleClickOutside(event: MouseEvent) {
		if (openMenuId !== null) {
			const target = event.target as HTMLElement | null;
			if (target?.closest('[data-gmail-menu]') || target?.closest('[data-gmail-menu-trigger]')) {
				return;
			}
			closeMenu();
		}
	}

	document.addEventListener('click', handleClickOutside);

	return () => {
		document.removeEventListener('click', handleClickOutside);
	};
});

async function checkGmailStatus() {
	try {
		const response = await fetch('/api/auth/gmail/status');
		if (response.ok) {
			const data = await response.json();
			const connections: GmailConnectionView[] = Array.isArray(data.connections)
				? data.connections.map((conn: any) => ({
					id: conn.id,
					email: conn.email,
					connectedAt: conn.connected_at ?? conn.connectedAt ?? null,
					lastRefreshedAt: conn.last_refreshed_at ?? conn.lastRefreshedAt ?? null,
					accountType: conn.accountType || 'send'
				}))
				: [];
			gmailConnections = connections;
			if (connections.length > 0) {
				gmailError = null;
			}
		}
	} catch (error) {
		console.error('Failed to check Gmail status:', error);
	}
}

async function disconnectGmail(connectionId: string, email: string) {
	if (gmailDisconnectingId) return;
	if (!confirm(`Disconnect ${email}? You will need to reconnect it to send outreach emails.`)) {
		return;
	}
	gmailDisconnectingId = connectionId;
	gmailError = null;
	gmailMessage = null;
	try {
		const response = await fetch('/api/auth/gmail/disconnect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ connectionId })
		});
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ message: 'Failed to disconnect Gmail' }));
			throw new Error(errorData.error?.message || 'Failed to disconnect Gmail');
		}
		await checkGmailStatus();
		gmailMessage = `${email} disconnected successfully.`;
	} catch (error) {
		gmailError = error instanceof Error ? error.message : 'Failed to disconnect Gmail account.';
	} finally {
		gmailDisconnectingId = null;
	}
}

function connectNewGmail() {
	showAccountTypeModal = true;
}

function closeAccountTypeModal() {
	showAccountTypeModal = false;
}

function confirmConnectGmail() {
	showAccountTypeModal = false;
	window.location.href = `/api/auth/gmail/connect?accountType=${selectedAccountType}`;
}

function toggleMenu(connectionId: string, event?: MouseEvent) {
	if (openMenuId === connectionId) {
		openMenuId = null;
		menuPosition = null;
	} else {
		openMenuId = connectionId;
		if (event && typeof window !== 'undefined') {
			const button = event.currentTarget as HTMLElement;
			menuButtonRefs.set(connectionId, button);
			const rect = button.getBoundingClientRect();
			menuPosition = {
				top: rect.bottom + window.scrollY + 4,
				right: window.innerWidth - rect.right
			};
		}
	}
}

function closeMenu() {
	openMenuId = null;
	menuPosition = null;
}

function reconnectGmail(connectionId: string) {
	gmailReconnectId = connectionId;
	window.location.href = `/api/auth/gmail/connect?connectionId=${encodeURIComponent(connectionId)}`;
}
</script>

<div class="gmail-page">
	<!-- Page Header -->
	<header class="page-header">
		<h1 class="page-title">Gmail Connections</h1>
		<p class="page-subtitle">Connect Gmail accounts to send outreach emails on your behalf</p>
	</header>

	<!-- Alerts -->
	{#if gmailError}
		<div class="alert alert-error">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
			</svg>
			<span>{gmailError}</span>
		</div>
	{/if}

	{#if gmailMessage}
		<div class="alert alert-success">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>{gmailMessage}</span>
		</div>
	{/if}

	<!-- Main Content Grid -->
	<div class="gmail-grid">
		<!-- Left Column - Connections -->
		<div class="gmail-column gmail-column-main">
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="currentColor">
							<path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
						</svg>
					</div>
					<div>
						<h2 class="card-title">Connected Mailboxes</h2>
						<p class="card-description">{gmailConnections.length} {gmailConnections.length === 1 ? 'account' : 'accounts'} connected</p>
					</div>
				</div>

				<div class="card-content">
					{#if gmailConnections.length === 0}
						<!-- Empty State -->
						<div class="empty-state">
							<div class="empty-icon">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
								</svg>
							</div>
							<h3 class="empty-title">No Gmail accounts connected</h3>
							<p class="empty-description">
								Connect your Gmail account to start sending personalized outreach emails to influencers.
							</p>
							<button type="button" class="btn btn-primary" onclick={connectNewGmail}>
								Connect Gmail
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M5 12h14M12 5l7 7-7 7"/>
								</svg>
							</button>
						</div>
					{:else}
						<!-- Connections List -->
						<div class="connections-list">
							{#each gmailConnections as connection, index}
								<div class="connection-item">
									<div class="connection-main">
										<div class="connection-avatar">
											<svg viewBox="0 0 24 24" fill="currentColor">
												<path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
											</svg>
										</div>
										<div class="connection-info">
											<h3 class="connection-email">{connection.email}</h3>
											<div class="connection-meta">
												<span class="connection-type" class:type-draft={connection.accountType === 'draft'} class:type-send={connection.accountType === 'send'}>
													{connection.accountType === 'draft' ? 'Draft Only' : 'Send & Draft'}
												</span>
												{#if connection.connectedAt}
													<span class="meta-dot"></span>
													<span class="connection-date">Connected {formatGmailTimestamp(connection.connectedAt)}</span>
												{/if}
											</div>
										</div>
									</div>
									<div class="connection-actions" data-gmail-menu>
										<button
											type="button"
											class="menu-trigger"
											data-gmail-menu-trigger
											onclick={(e) => toggleMenu(connection.id, e)}
											aria-label="Menu options for {connection.email}"
										>
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
											</svg>
										</button>
										{#if openMenuId === connection.id && menuPosition}
											<div class="dropdown-menu" style="top: {menuPosition.top}px; right: {menuPosition.right}px;">
												<button
													type="button"
													class="dropdown-item"
													onclick={() => { reconnectGmail(connection.id); closeMenu(); }}
													disabled={gmailReconnectId === connection.id}
												>
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
													</svg>
													{gmailReconnectId === connection.id ? 'Redirecting...' : 'Reconnect'}
												</button>
												<div class="dropdown-divider"></div>
												<button
													type="button"
													class="dropdown-item dropdown-item-danger"
													onclick={() => { disconnectGmail(connection.id, connection.email); closeMenu(); }}
													disabled={gmailDisconnectingId === connection.id}
												>
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
													</svg>
													{gmailDisconnectingId === connection.id ? 'Disconnecting...' : 'Disconnect'}
												</button>
											</div>
										{/if}
									</div>
								</div>
								{#if index < gmailConnections.length - 1}
									<div class="connection-divider"></div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			</section>
		</div>

		<!-- Right Column - Info -->
		<div class="gmail-column gmail-column-side">
			<!-- How it works -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">How it works</h2>
						<p class="card-description">Gmail integration overview</p>
					</div>
				</div>

				<div class="card-content">
					<div class="info-list">
						<div class="info-item">
							<div class="info-number">1</div>
							<div class="info-text">
								<strong>Connect your account</strong>
								<span>Sign in with Google and grant permission to send emails.</span>
							</div>
						</div>
						<div class="info-item">
							<div class="info-number">2</div>
							<div class="info-text">
								<strong>Draft or send emails</strong>
								<span>Create drafts for review or send directly from campaigns.</span>
							</div>
						</div>
						<div class="info-item">
							<div class="info-number">3</div>
							<div class="info-text">
								<strong>Track responses</strong>
								<span>View replies and manage conversations in your inbox.</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Security Info -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Security & Privacy</h2>
						<p class="card-description">Your data is protected</p>
					</div>
				</div>

				<div class="card-content">
					<div class="security-list">
						<div class="security-item">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							<span>OAuth 2.0 secure authentication</span>
						</div>
						<div class="security-item">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							<span>We never store your password</span>
						</div>
						<div class="security-item">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							<span>Revoke access anytime from Google</span>
						</div>
						<div class="security-item">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							<span>Data encrypted in transit</span>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
</div>

<!-- Account Type Modal -->
{#if showAccountTypeModal}
	<div class="modal-backdrop">
		<button
			type="button"
			class="backdrop-close"
			aria-label="Close dialog"
			onclick={closeAccountTypeModal}
		></button>
		<div class="modal-content">
			<h2 class="modal-title">Choose Account Type</h2>
			<p class="modal-description">
				Select how you want to use this Gmail account with Penny.
			</p>

			<div class="account-options">
				<label class="account-option" class:account-option-selected={selectedAccountType === 'draft'}>
					<input
						type="radio"
						name="accountType"
						value="draft"
						bind:group={selectedAccountType}
						class="option-radio"
					/>
					<div class="option-content">
						<div class="option-header">
							<span class="option-title">Draft Only</span>
							<span class="option-badge badge-draft">Recommended for review</span>
						</div>
						<p class="option-description">
							Creates drafts in Gmail for you to review and send manually. Best if you want to approve each email before sending.
						</p>
					</div>
				</label>

				<label class="account-option" class:account-option-selected={selectedAccountType === 'send'}>
					<input
						type="radio"
						name="accountType"
						value="send"
						bind:group={selectedAccountType}
						class="option-radio"
					/>
					<div class="option-content">
						<div class="option-header">
							<span class="option-title">Send & Draft</span>
							<span class="option-badge badge-send">Full automation</span>
						</div>
						<p class="option-description">
							Can both create drafts and send emails directly. Use this for automated outreach campaigns.
						</p>
					</div>
				</label>
			</div>

			<div class="modal-actions">
				<button type="button" class="btn btn-secondary" onclick={closeAccountTypeModal}>
					Cancel
				</button>
				<button type="button" class="btn btn-primary" onclick={confirmConnectGmail}>
					Connect Gmail
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.gmail-page {
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

	.page-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2.5rem;
		font-weight: 400;
		color: var(--ink);
		line-height: 1.1;
		margin: 0 0 0.5rem 0;
	}

	.page-subtitle {
		font-size: 1rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Alerts */
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		line-height: 1.5;
		margin-bottom: 1.5rem;
	}

	.alert svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.alert-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #991b1b;
	}

	.alert-error svg {
		color: #ef4444;
	}

	.alert-success {
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #166534;
	}

	.alert-success svg {
		color: #10b981;
	}

	/* Gmail Grid */
	.gmail-grid {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	.gmail-column {
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

	.card-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
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

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}

	.empty-icon {
		width: 56px;
		height: 56px;
		margin: 0 auto 1.25rem;
		color: var(--ink-muted);
		opacity: 0.5;
	}

	.empty-icon svg {
		width: 100%;
		height: 100%;
	}

	.empty-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 0.5rem 0;
	}

	.empty-description {
		font-size: 0.9375rem;
		color: var(--ink-muted);
		margin: 0 0 1.5rem 0;
		max-width: 320px;
		margin-left: auto;
		margin-right: auto;
	}

	/* Connections List */
	.connections-list {
		display: flex;
		flex-direction: column;
	}

	.connection-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 0;
		gap: 1rem;
	}

	.connection-item:first-child {
		padding-top: 0;
	}

	.connection-item:last-child {
		padding-bottom: 0;
	}

	.connection-divider {
		height: 1px;
		background: var(--border);
	}

	.connection-main {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex: 1;
		min-width: 0;
	}

	.connection-avatar {
		width: 44px;
		height: 44px;
		background: var(--paper);
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.connection-avatar svg {
		width: 22px;
		height: 22px;
		color: var(--ink-muted);
	}

	.connection-info {
		flex: 1;
		min-width: 0;
	}

	.connection-email {
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 0.375rem 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.connection-meta {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.connection-type {
		display: inline-flex;
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
		font-weight: 500;
		border-radius: 4px;
	}

	.type-draft {
		background: #dbeafe;
		color: #1e40af;
	}

	.type-send {
		background: #dcfce7;
		color: #166534;
	}

	.meta-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--border);
	}

	.connection-date {
		font-size: 0.8125rem;
		color: var(--ink-muted);
	}

	/* Menu Trigger */
	.menu-trigger {
		padding: 0.5rem;
		background: none;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: 6px;
		transition: all 0.15s ease;
	}

	.menu-trigger:hover {
		color: var(--ink);
		background: var(--paper);
	}

	.menu-trigger svg {
		width: 20px;
		height: 20px;
	}

	/* Dropdown Menu */
	.dropdown-menu {
		position: fixed;
		z-index: 50;
		width: 180px;
		background: var(--paper-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.15);
		padding: 0.5rem 0;
	}

	.dropdown-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 1rem;
		font-size: 0.875rem;
		color: var(--ink-light);
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		transition: background 0.15s ease;
	}

	.dropdown-item:hover:not(:disabled) {
		background: var(--paper);
	}

	.dropdown-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dropdown-item-danger {
		color: var(--error);
	}

	.dropdown-item svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.dropdown-divider {
		height: 1px;
		background: var(--border);
		margin: 0.5rem 0;
	}

	/* Info List */
	.info-list {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.info-item {
		display: flex;
		gap: 1rem;
	}

	.info-number {
		width: 28px;
		height: 28px;
		background: var(--coral);
		color: white;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.info-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-top: 0.25rem;
	}

	.info-text strong {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--ink);
	}

	.info-text span {
		font-size: 0.8125rem;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	/* Security List */
	.security-list {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.security-item {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
	}

	.security-item svg {
		width: 16px;
		height: 16px;
		color: var(--coral);
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.security-item span {
		font-size: 0.875rem;
		color: var(--ink-light);
		line-height: 1.4;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		font-family: inherit;
		text-decoration: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn svg {
		width: 18px;
		height: 18px;
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

	.btn-secondary {
		background: var(--paper);
		color: var(--ink);
		border: 1px solid var(--border);
	}

	.btn-secondary:hover:not(:disabled) {
		border-color: var(--ink-muted);
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}

	.backdrop-close {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		border: none;
		cursor: pointer;
	}

	.modal-content {
		position: relative;
		width: 100%;
		max-width: 480px;
		background: var(--paper-elevated);
		border-radius: 12px;
		padding: 2rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	}

	.modal-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0 0 0.5rem 0;
	}

	.modal-description {
		font-size: 0.9375rem;
		color: var(--ink-muted);
		margin: 0 0 1.5rem 0;
	}

	/* Account Options */
	.account-options {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 2rem;
	}

	.account-option {
		display: flex;
		gap: 1rem;
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.account-option:hover {
		border-color: var(--ink-muted);
	}

	.account-option-selected {
		border-color: var(--coral);
		background: #fff7f6;
	}

	.option-radio {
		margin-top: 0.25rem;
		accent-color: var(--coral);
	}

	.option-content {
		flex: 1;
	}

	.option-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.option-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
	}

	.option-badge {
		font-size: 0.6875rem;
		font-weight: 500;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge-draft {
		background: #dbeafe;
		color: #1e40af;
	}

	.badge-send {
		background: #dcfce7;
		color: #166534;
	}

	.option-description {
		font-size: 0.875rem;
		color: var(--ink-light);
		line-height: 1.5;
		margin: 0;
	}

	/* Modal Actions */
	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.gmail-grid {
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

		.card-header {
			padding: 1rem 1.25rem;
		}

		.card-content {
			padding: 1.25rem;
		}

		.connection-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.connection-actions {
			align-self: flex-end;
		}

		.modal-content {
			padding: 1.5rem;
		}

		.modal-actions {
			flex-direction: column;
		}

		.modal-actions .btn {
			width: 100%;
		}
	}
</style>
