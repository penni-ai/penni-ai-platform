<script lang="ts">
import Button from '$lib/components/Button.svelte';
import { onMount } from 'svelte';

interface GmailConnectionView {
	id: string;
	email: string;
	connectedAt: number | null;
	lastRefreshedAt: number | null;
}

let gmailConnections = $state<GmailConnectionView[]>([]);
let gmailError = $state<string | null>(null);
let gmailMessage = $state<string | null>(null);
let gmailDisconnectingId = $state<string | null>(null);
let gmailReconnectId = $state<string | null>(null);
let openMenuId = $state<string | null>(null);
let menuButtonRefs = $state<Map<string, HTMLElement>>(new Map());
let menuPosition = $state<{ top: number; right: number } | null>(null);

function formatGmailTimestamp(value: number | null): string | null {
	if (!value) return null;
	return new Date(value).toLocaleString();
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
					lastRefreshedAt: conn.last_refreshed_at ?? conn.lastRefreshedAt ?? null
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
	window.location.href = '/api/auth/gmail/connect';
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

<section class="flex flex-col gap-6">
	<div>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-base font-semibold text-gray-900">Gmail Mailboxes</h2>
			<Button type="button" onclick={() => connectNewGmail()} class="px-4 py-1.5 text-sm">
				Connect another Gmail
			</Button>
		</div>
		
		{#if gmailConnections.length === 0}
			<div class="border border-dashed border-gray-300 rounded-md px-4 py-8 text-center text-sm text-gray-600">
				<p>No Gmail mailboxes are connected yet.</p>
				<Button type="button" class="px-4 py-1.5 text-sm mt-3" onclick={() => connectNewGmail()}>
					Connect Gmail account
				</Button>
			</div>
		{:else}
			<div class="border border-gray-200 rounded-md">
				<div class="overflow-x-auto">
					<table class="min-w-full text-left text-sm">
						<thead class="text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-50">
							<tr>
								<th class="px-4 py-3">Email</th>
								<th class="px-4 py-3">Connected</th>
								<th class="px-4 py-3">Last refreshed</th>
								<th class="px-4 py-3 text-right">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100 bg-white">
							{#each gmailConnections as connection}
								<tr class="hover:bg-gray-50">
									<td class="px-4 py-3">
										<div class="flex items-center gap-2">
											<svg class="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
												<path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
											</svg>
											<span class="text-gray-900 font-medium">{connection.email}</span>
										</div>
									</td>
									<td class="px-4 py-3 text-gray-600">
										{#if connection.connectedAt}
											{formatGmailTimestamp(connection.connectedAt)}
										{:else}
											<span class="text-gray-400">—</span>
										{/if}
									</td>
									<td class="px-4 py-3 text-gray-600">
										{#if connection.lastRefreshedAt}
											{formatGmailTimestamp(connection.lastRefreshedAt)}
										{:else}
											<span class="text-gray-400">—</span>
										{/if}
									</td>
									<td class="px-4 py-3">
										<div class="flex items-center justify-end">
											<div class="relative" data-gmail-menu>
												<button
													type="button"
													data-gmail-menu-trigger
													onclick={(e) => toggleMenu(connection.id, e)}
													class="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
												>
													<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
													</svg>
												</button>
												{#if openMenuId === connection.id && menuPosition}
													<div class="fixed z-50 w-40 rounded-md border border-gray-200 bg-white shadow-lg" data-gmail-menu style="top: {menuPosition.top}px; right: {menuPosition.right}px;">
														<div class="py-1">
															<button
																type="button"
																onclick={() => {
																	reconnectGmail(connection.id);
																	closeMenu();
																}}
																disabled={gmailReconnectId === connection.id}
																class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
															>
																{gmailReconnectId === connection.id ? 'Redirecting…' : 'Reconnect'}
															</button>
															<button
																type="button"
																onclick={() => {
																	disconnectGmail(connection.id, connection.email);
																	closeMenu();
																}}
																disabled={gmailDisconnectingId === connection.id}
																class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
															>
																{gmailDisconnectingId === connection.id ? 'Disconnecting…' : 'Disconnect'}
															</button>
														</div>
													</div>
												{/if}
											</div>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		{#if gmailError}
			<div class="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{gmailError}
			</div>
		{/if}
		{#if gmailMessage}
			<div class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
				{gmailMessage}
			</div>
		{/if}
	</div>
</section>

