<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type EmailMessage = {
		id: string;
		subject: string;
		from: string;
		fromEmail: string;
		to: string;
		cc?: string;
		body: string;
		timestamp: string;
		status?: string;
		sequence?: string;
		avatarColor: string;
	};

	type Contact = {
		id: string;
		name: string;
		preview: string;
		time: string;
		avatarColor: string;
	};

	interface QueuedEmail {
		id: string;
		campaignId: string | null;
		influencerId: string | null;
		influencerName: string | null;
		to: string;
		subject: string;
		htmlBody: string;
		senderConnectionId: string;
		senderEmail: string;
		status: 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled';
		priority: number;
		createdAt: number;
		scheduledFor: number;
		processedAt: number | null;
		sentAt: number | null;
		attempts: number;
		maxAttempts: number;
		lastError: string | null;
		lastAttemptAt: number | null;
		updatedAt: number;
	}

	// Mock data matching the screenshot
	const emails: EmailMessage[] = [
		{
			id: '1',
			subject: 'Re: Invitation to Eazeye Launch October 4th!',
			from: 'Prabhleen Thiara',
			fromEmail: 'Prabhleen@dulcedo.com',
			to: 'abby@dime-us.org',
			cc: 'janeezzhao@dulcedo.com',
			body: 'Hi Abby, Happy Thursday! I\'m just checking in on my previous email! Best, Please note that our office is closed...',
			timestamp: 'Lead Relied on Oct 16, 2025, 1:16 PM EDT',
			status: 'lead_relied',
			avatarColor: 'bg-amber-200'
		},
		{
			id: '2',
			subject: 'Re: Follow-Up on Project Alpha',
			from: 'Prabhleen Thiara',
			fromEmail: 'Prabhleen@dulcedo.com',
			to: 'mark@projectx.com',
			cc: 'michael@creativex.com',
			body: 'Hi Mark, Just wanted to follow up on our last discussion regarding Project Alpha. Looking forward to your thoughts!',
			timestamp: 'Responded to Mark',
			sequence: '(Email Sequence:2)',
			status: 'responded',
			avatarColor: 'bg-amber-200'
		},
		{
			id: '3',
			subject: 'Re: Feedback on Design Draft',
			from: 'Prabhleen Thiara',
			fromEmail: 'Prabhleen@dulcedo.com',
			to: 'john@clientlist.com',
			cc: 'sarah@designhub.com',
			body: 'Hi John, Thanks for your patience! I\'ve attached the updated draft for your review and would love your feedback.',
			timestamp: 'Replied to John',
			sequence: '(Email Sequence:3)',
			status: 'action_required',
			avatarColor: 'bg-amber-200'
		},
		{
			id: '4',
			subject: 'Followed up with Lisa',
			from: 'Prabhleen Thiara',
			fromEmail: 'Prabhleen@dulcedo.com',
			to: 'lisa@company.com',
			body: 'Follow up email content...',
			timestamp: 'Followed up with Lisa',
			sequence: '(Email Sequence:4)',
			status: 'awaiting_response',
			avatarColor: 'bg-amber-200'
		}
	];

	const contacts: Contact[] = [
		{ id: '1', name: 'Michael Lee', preview: 'See you all in a bit!', time: '7:12 AM', avatarColor: 'bg-purple-200' },
		{ id: '2', name: 'Jessica Chen', preview: 'Looking forward to it!', time: '7:30 AM', avatarColor: 'bg-amber-200' },
		{ id: '3', name: 'David Wong', preview: 'I\'ll be there right on time.', time: '7:45 AM', avatarColor: 'bg-coral' },
		{ id: '4', name: 'Emily Davis', preview: 'Can\'t wait to discuss!', time: '8:00 AM', avatarColor: 'bg-amber-200' },
		{ id: '5', name: 'Chris Johnson', preview: 'Sounds good, see you!', time: '8:15 AM', avatarColor: 'bg-orange-100' },
		{ id: '6', name: 'Katie Smith', preview: 'I\'ll grab coffee before the meeting.', time: '8:30 AM', avatarColor: 'bg-purple-200' },
		{ id: '7', name: 'Ryan Brown', preview: 'Ready to dive in!', time: '8:45 AM', avatarColor: 'bg-blue-200' },
		{ id: '8', name: 'Lucy Green', preview: 'Just finished my prep!', time: '9:00 AM', avatarColor: 'bg-coral' }
	];

	// Main tab state - default to outreach status
	let mainTab = $state<'replies' | 'outreach'>('outreach');

	// Replies tab state
	let viewFilter = $state<'all' | 'interested' | 'not_interested'>('all');
	let searchTerm = $state('');
	let selectedEmailId = $state<string>(emails[0].id);
	let overflowOpen = $state(false);
	let deleteModalOpen = $state(false);
	let deletedConversationIds = $state<string[]>([]);

	// Outreach tab state
	let outreachFilter = $state<'all' | 'queued' | 'processing' | 'sent' | 'failed'>('all');
	let actionLoading = $state<Record<string, boolean>>({});
	let hoveredErrorId = $state<string | null>(null);

	const selectedEmail = $derived(emails.find((email) => email.id === selectedEmailId) ?? emails[0]);
	const isDeleted = $derived(deletedConversationIds.includes(selectedEmailId));

	// Derived outreach data
	const outreachEmails = $derived(data.outreachEmails ?? []);
	const outreachStats = $derived(data.outreachStats ?? { queued: 0, processing: 0, sent: 0, failed: 0, cancelled: 0, total: 0 });

	const filteredOutreachEmails = $derived(
		outreachFilter === 'all'
			? outreachEmails
			: outreachEmails.filter((email: QueuedEmail) => email.status === outreachFilter)
	);

	function getStatusColor(status?: string) {
		if (status === 'action_required') return 'status-action';
		if (status === 'responded') return 'status-responded';
		return 'status-default';
	}

	function getStatusLabel(status?: string) {
		if (status === 'action_required') return 'Action Required';
		if (status === 'responded') return 'Review Reply';
		if (status === 'awaiting_response') return 'Awaiting Response';
		return '';
	}

	function handleSelectContact(contactId: string) {
		selectedEmailId = contactId;
		overflowOpen = false;
		deleteModalOpen = false;
	}

	function toggleOverflow() {
		overflowOpen = !overflowOpen;
	}

	function openDeleteModal() {
		deleteModalOpen = true;
		overflowOpen = false;
	}

	function cancelDelete() {
		deleteModalOpen = false;
	}

	function confirmDelete() {
		if (!deletedConversationIds.includes(selectedEmailId)) {
			deletedConversationIds = [...deletedConversationIds, selectedEmailId];
		}
		deleteModalOpen = false;
	}

	// Outreach actions
	async function retryEmail(emailId: string) {
		actionLoading[emailId] = true;
		try {
			const response = await fetch(`/api/outreach/queue/${emailId}?action=retry`, {
				method: 'POST'
			});
			if (response.ok) {
				// Trigger a page reload or update state
				window.location.reload();
			}
		} catch (error) {
			console.error('Failed to retry email:', error);
		} finally {
			actionLoading[emailId] = false;
		}
	}

	async function cancelEmail(emailId: string) {
		actionLoading[emailId] = true;
		try {
			const response = await fetch(`/api/outreach/queue/${emailId}`, {
				method: 'DELETE'
			});
			if (response.ok) {
				// Trigger a page reload or update state
				window.location.reload();
			}
		} catch (error) {
			console.error('Failed to cancel email:', error);
		} finally {
			actionLoading[emailId] = false;
		}
	}

	function formatTime(timestamp: number | null): string {
		if (!timestamp) return '-';
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatScheduledTime(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = date.getTime() - now.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);

		if (diffMins < 0) return 'Now';
		if (diffMins < 60) return `in ${diffMins}m`;
		if (diffHours < 24) return `in ${diffHours}h`;

		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function getInitial(name: string | null, email: string): string {
		if (name) return name.charAt(0).toUpperCase();
		return email.charAt(0).toUpperCase();
	}

	function getAvatarColor(email: string): string {
		const colors = ['bg-coral', 'bg-amber-200', 'bg-purple-200', 'bg-blue-200', 'bg-orange-100'];
		const index = email.charCodeAt(0) % colors.length;
		return colors[index];
	}

	function truncateSubject(subject: string, maxLength: number = 50): string {
		if (subject.length <= maxLength) return subject;
		return subject.substring(0, maxLength) + '...';
	}
</script>

<div class="inbox-page">
	<!-- Page Header with Tab Navigation -->
	<header class="page-header">
		<div class="header-content">
			<h1 class="page-title">Inbox</h1>
			<nav class="main-tabs">
				<button
					type="button"
					class="main-tab"
					class:main-tab-active={mainTab === 'replies'}
					onclick={() => mainTab = 'replies'}
				>
					Replies
				</button>
				<button
					type="button"
					class="main-tab"
					class:main-tab-active={mainTab === 'outreach'}
					onclick={() => mainTab = 'outreach'}
				>
					Outreach Status
				</button>
			</nav>
		</div>
	</header>

	<!-- Replies View -->
	{#if mainTab === 'replies'}
		<div class="replies-view">
			<!-- Contact List Panel -->
			<aside class="contact-panel">
				<div class="contact-panel-inner">
					<!-- Search -->
					<div class="search-container">
						<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<circle cx="11" cy="11" r="8" />
							<path d="m21 21-4.35-4.35" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<input
							type="search"
							placeholder="Search influencer or email"
							class="search-input"
							bind:value={searchTerm}
						/>
					</div>

					<!-- Filter Tabs -->
					<div class="filter-tabs">
						{#each [{ value: 'all', label: 'All replies' }, { value: 'interested', label: 'Interested' }, { value: 'not_interested', label: 'Not interested' }] as tab}
							<button
								type="button"
								onclick={() => (viewFilter = tab.value as typeof viewFilter)}
								class="filter-tab"
								class:filter-tab-active={viewFilter === tab.value}
							>
								{tab.label}
							</button>
						{/each}
					</div>

					<hr class="panel-rule" />

					<!-- Contact List -->
					<div class="contact-list">
						{#each contacts as contact}
							<button
								type="button"
								class="contact-item"
								class:contact-item-active={contact.id === selectedEmailId}
								onclick={() => handleSelectContact(contact.id)}
								aria-pressed={contact.id === selectedEmailId ? 'true' : 'false'}
							>
								<div class="contact-avatar {contact.avatarColor}">
									{contact.name[0]}
								</div>
								<div class="contact-info">
									<div class="contact-row">
										<span class="contact-name">{contact.name}</span>
										<span class="contact-time">{contact.time}</span>
									</div>
									<p class="contact-preview">{contact.preview}</p>
								</div>
							</button>
						{/each}
					</div>
				</div>
			</aside>

			<!-- Email Content Panel -->
			<main class="email-panel">
				<!-- Email Header -->
				<header class="email-header">
					<div class="email-sender">
						<div class="sender-info">
							<h2 class="sender-name">
								{selectedEmail.from}
								<span class="online-indicator"></span>
							</h2>
							<p class="sender-email">{selectedEmail.fromEmail}</p>
						</div>
					</div>
					<div class="header-actions">
						<button
							type="button"
							class="icon-btn"
							aria-label="Conversation menu"
							onclick={toggleOverflow}
						>
							<svg class="icon" fill="currentColor" viewBox="0 0 20 20">
								<path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
							</svg>
						</button>

						{#if overflowOpen}
							<div class="dropdown-menu">
								<button
									type="button"
									class="dropdown-item dropdown-item-danger"
									onclick={openDeleteModal}
								>
									<svg class="dropdown-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
									Delete conversation
								</button>
							</div>
						{/if}
					</div>
				</header>

				<hr class="content-rule" />

				<!-- Email Thread -->
				{#if isDeleted}
					<div class="deleted-state">
						<div class="deleted-icon">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2.5 2.5" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0z" />
							</svg>
						</div>
						<h3 class="deleted-title">This conversation has been deleted.</h3>
						<p class="deleted-description">You can start a new conversation anytime.</p>
					</div>
				{:else}
					<div class="email-thread">
						{#each emails as email}
							<article class="email-item">
								<!-- Email Status Header -->
								<div class="email-status-row">
									<svg class="email-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
										<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
									</svg>
									<span class="email-timestamp">
										{email.timestamp}
										{#if email.sequence}
											<span class="email-sequence">{email.sequence}</span>
										{/if}
										on
										{#if email.id === '2'}
											Sep 30, 2025, 2:15 PM EDT
										{:else if email.id === '3'}
											Sep 30, 2025, 4:45 PM EDT
										{:else if email.id === '4'}
											Oct 1, 2025, 11:00 AM EDT
										{/if}
									</span>
									{#if getStatusLabel(email.status)}
										<span class="email-status-label {getStatusColor(email.status)}">{getStatusLabel(email.status)}</span>
									{/if}
								</div>

								<!-- Email Content -->
								<div class="email-content">
									<header class="email-content-header">
										<h3 class="email-subject">{email.subject}</h3>
										<div class="email-meta">
											<div class="email-avatar {email.avatarColor}">
												{email.from[0]}
											</div>
											<div class="email-addresses">
												<p class="email-from">
													<strong>{email.from}</strong>
													<span class="email-from-address">{email.fromEmail}</span>
												</p>
												<p class="email-to">
													<span class="address-label">To:</span>
													<span>{email.to}</span>
												</p>
												{#if email.cc}
													<p class="email-cc">
														<span class="address-label">cc:</span>
														<span>{email.cc}</span>
													</p>
												{/if}
											</div>
											<div class="email-actions">
												<button type="button" class="icon-btn" title="Reply">
													<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
													</svg>
												</button>
												<button type="button" class="icon-btn" title="Forward">
													<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
													</svg>
												</button>
												<button type="button" class="icon-btn" title="More">
													<svg class="icon" fill="currentColor" viewBox="0 0 20 20">
														<path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
													</svg>
												</button>
											</div>
										</div>
									</header>

									<hr class="email-rule" />

									<div class="email-body">
										<p>{email.body}</p>
									</div>
								</div>
							</article>
						{/each}
					</div>
				{/if}
			</main>
		</div>
	{/if}

	<!-- Outreach Status View -->
	{#if mainTab === 'outreach'}
		<div class="outreach-view">
			<!-- Stats Row -->
			<div class="stats-row">
				<button
					type="button"
					class="stat-card"
					class:stat-card-active={outreachFilter === 'queued'}
					onclick={() => outreachFilter = outreachFilter === 'queued' ? 'all' : 'queued'}
				>
					<div class="stat-icon stat-icon-queued">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<circle cx="12" cy="12" r="10" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2" />
						</svg>
					</div>
					<div class="stat-content">
						<span class="stat-value">{outreachStats.queued}</span>
						<span class="stat-label">Queued</span>
					</div>
				</button>

				<button
					type="button"
					class="stat-card"
					class:stat-card-active={outreachFilter === 'processing'}
					onclick={() => outreachFilter = outreachFilter === 'processing' ? 'all' : 'processing'}
				>
					<div class="stat-icon stat-icon-processing">
						<svg class="spinner" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
						</svg>
					</div>
					<div class="stat-content">
						<span class="stat-value">{outreachStats.processing}</span>
						<span class="stat-label">Processing</span>
					</div>
				</button>

				<button
					type="button"
					class="stat-card"
					class:stat-card-active={outreachFilter === 'sent'}
					onclick={() => outreachFilter = outreachFilter === 'sent' ? 'all' : 'sent'}
				>
					<div class="stat-icon stat-icon-sent">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
					<div class="stat-content">
						<span class="stat-value">{outreachStats.sent}</span>
						<span class="stat-label">Sent</span>
					</div>
				</button>

				<button
					type="button"
					class="stat-card"
					class:stat-card-active={outreachFilter === 'failed'}
					onclick={() => outreachFilter = outreachFilter === 'failed' ? 'all' : 'failed'}
				>
					<div class="stat-icon stat-icon-failed">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
						</svg>
					</div>
					<div class="stat-content">
						<span class="stat-value">{outreachStats.failed}</span>
						<span class="stat-label">Failed</span>
					</div>
				</button>
			</div>

			<!-- Filter Pills -->
			<div class="filter-pills">
				{#each [
					{ value: 'all', label: 'All' },
					{ value: 'queued', label: 'Queued' },
					{ value: 'processing', label: 'Processing' },
					{ value: 'sent', label: 'Sent' },
					{ value: 'failed', label: 'Failed' }
				] as filter}
					<button
						type="button"
						class="filter-pill"
						class:filter-pill-active={outreachFilter === filter.value}
						onclick={() => outreachFilter = filter.value as typeof outreachFilter}
					>
						{filter.label}
					</button>
				{/each}
			</div>

			<!-- Email Queue List -->
			<div class="queue-list">
				{#if filteredOutreachEmails.length === 0}
					<div class="empty-state">
						<div class="empty-icon">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
							</svg>
						</div>
						<h3 class="empty-title">No emails to display</h3>
						<p class="empty-description">
							{#if outreachFilter === 'all'}
								Your outreach queue is empty. Start a campaign to see emails here.
							{:else}
								No {outreachFilter} emails found.
							{/if}
						</p>
					</div>
				{:else}
					{#each filteredOutreachEmails as email (email.id)}
						<div class="queue-item">
							<div class="queue-item-main">
								<div class="queue-avatar {getAvatarColor(email.to)}">
									{getInitial(email.influencerName, email.to)}
								</div>
								<div class="queue-content">
									<div class="queue-recipient">
										<span class="recipient-name">{email.influencerName ?? email.to}</span>
										{#if email.influencerName}
											<span class="recipient-email">{email.to}</span>
										{/if}
									</div>
									<p class="queue-subject">{truncateSubject(email.subject)}</p>
								</div>
								<div class="queue-meta">
									<span class="queue-status queue-status-{email.status}">
										{email.status.charAt(0).toUpperCase() + email.status.slice(1)}
									</span>
									<span class="queue-time">
										{#if email.status === 'sent'}
											{formatTime(email.sentAt)}
										{:else if email.status === 'failed'}
											{formatTime(email.lastAttemptAt)}
										{:else if email.status === 'queued'}
											{formatScheduledTime(email.scheduledFor)}
										{:else}
											{formatTime(email.createdAt)}
										{/if}
									</span>
								</div>
							</div>
							<div class="queue-item-actions">
								{#if email.status === 'failed'}
									<div
										class="error-tooltip-wrapper"
										onmouseenter={() => hoveredErrorId = email.id}
										onmouseleave={() => hoveredErrorId = null}
									>
										<button type="button" class="action-btn action-btn-info" title="View error">
											<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
												<path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
											</svg>
										</button>
										{#if hoveredErrorId === email.id && email.lastError}
											<div class="error-tooltip">
												{email.lastError}
											</div>
										{/if}
									</div>
									<button
										type="button"
										class="action-btn action-btn-retry"
										onclick={() => retryEmail(email.id)}
										disabled={actionLoading[email.id]}
									>
										{#if actionLoading[email.id]}
											<svg class="spinner-small" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
												<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
											</svg>
										{:else}
											Retry
										{/if}
									</button>
								{:else if email.status === 'queued'}
									<span class="scheduled-time">Scheduled: {formatScheduledTime(email.scheduledFor)}</span>
									<button
										type="button"
										class="action-btn action-btn-cancel"
										onclick={() => cancelEmail(email.id)}
										disabled={actionLoading[email.id]}
									>
										{#if actionLoading[email.id]}
											<svg class="spinner-small" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
												<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
											</svg>
										{:else}
											Cancel
										{/if}
									</button>
								{:else if email.status === 'processing'}
									<span class="processing-indicator">
										<svg class="spinner-small" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
										</svg>
										Sending...
									</span>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Delete Confirmation Modal -->
{#if deleteModalOpen}
	<div class="modal-backdrop">
		<button
			type="button"
			class="backdrop-close"
			aria-label="Close delete dialog"
			onclick={cancelDelete}
		></button>
		<div class="modal-content">
			<div class="modal-icon">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</div>
			<h3 class="modal-title">Delete this conversation?</h3>
			<p class="modal-description">
				This removes the messages from your Penny inbox. Influencer replies will still stay in their inbox.
			</p>
			<div class="modal-actions">
				<button
					type="button"
					class="btn btn-primary"
					onclick={confirmDelete}
				>
					Delete conversation
				</button>
				<button
					type="button"
					class="btn btn-secondary"
					onclick={cancelDelete}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}


<style>
	.inbox-page {
		--coral: #FF6F61;
		--coral-dark: #e85d50;
		--ink: #1a1a1a;
		--ink-light: #4a4a4a;
		--ink-muted: #8a8a8a;
		--paper: #fafaf9;
		--paper-warm: #f5f4f2;
		--border: #e8e6e3;

		font-family: 'DM Sans', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--color-bg, var(--paper));
		color: var(--color-text, var(--ink));
	}

	/* Page Header */
	.page-header {
		flex-shrink: 0;
		background: var(--color-bg-elevated, white);
		border-bottom: 1px solid var(--color-border, var(--border));
		padding: 1.25rem 2rem;
	}

	.header-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 1600px;
		margin: 0 auto;
	}

	.page-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.75rem;
		font-weight: 400;
		color: var(--color-text, var(--ink));
		margin: 0;
	}

	/* Main Tabs */
	.main-tabs {
		display: flex;
		gap: 0.25rem;
		background: var(--color-bg, var(--paper));
		padding: 0.25rem;
		border-radius: 6px;
	}

	.main-tab {
		padding: 0.625rem 1.25rem;
		font-size: 0.875rem;
		font-weight: 500;
		font-family: inherit;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted, var(--ink-muted));
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.main-tab:hover {
		color: var(--color-text, var(--ink));
	}

	.main-tab-active {
		background: var(--color-bg-elevated, white);
		color: var(--color-text, var(--ink));
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	/* Replies View */
	.replies-view {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	/* Contact Panel */
	.contact-panel {
		width: 340px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--color-border, var(--border));
		background: var(--color-bg-elevated, white);
	}

	.contact-panel-inner {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* Search */
	.search-container {
		position: relative;
		padding: 1rem 1.5rem;
	}

	.search-icon {
		position: absolute;
		left: 2rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: var(--color-text-muted, var(--ink-muted));
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.625rem 1rem 0.625rem 2.25rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-border, var(--border));
		border-radius: 4px;
		background: var(--color-bg, var(--paper));
		color: var(--color-text, var(--ink));
		font-family: inherit;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--coral);
	}

	.search-input::placeholder {
		color: var(--color-text-muted, var(--ink-muted));
	}

	/* Filter Tabs */
	.filter-tabs {
		display: flex;
		gap: 0.5rem;
		padding: 0 1.5rem 1rem;
		flex-wrap: wrap;
	}

	.filter-tab {
		padding: 0.375rem 0.875rem;
		font-size: 0.75rem;
		font-weight: 500;
		border: 1px solid var(--color-border, var(--border));
		border-radius: 2px;
		background: var(--color-bg-elevated, white);
		color: var(--color-text-secondary, var(--ink-light));
		cursor: pointer;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.filter-tab:hover {
		border-color: var(--color-text-muted, var(--ink-muted));
	}

	.filter-tab-active {
		background: var(--color-text, var(--ink));
		border-color: var(--color-text, var(--ink));
		color: var(--color-bg-elevated, white);
	}

	.panel-rule {
		border: none;
		height: 1px;
		background: var(--color-border, var(--border));
		margin: 0;
	}

	/* Contact List */
	.contact-list {
		flex: 1;
		overflow-y: auto;
	}

	.contact-item {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		text-align: left;
		background: var(--color-bg-elevated, white);
		border: none;
		border-bottom: 1px solid var(--color-border, var(--border));
		cursor: pointer;
		transition: background 0.15s ease;
		font-family: inherit;
	}

	.contact-item:hover {
		background: var(--color-bg, var(--paper));
	}

	.contact-item-active {
		background: var(--color-bg-hover, var(--paper-warm));
	}

	.contact-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink);
		flex-shrink: 0;
	}

	.contact-info {
		flex: 1;
		min-width: 0;
	}

	.contact-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.contact-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text, var(--ink));
	}

	.contact-time {
		font-size: 0.75rem;
		color: var(--color-text-muted, var(--ink-muted));
		flex-shrink: 0;
	}

	.contact-preview {
		font-size: 0.8125rem;
		color: var(--color-text-secondary, var(--ink-light));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin: 0;
	}

	/* Email Panel */
	.email-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-elevated, white);
		overflow: hidden;
	}

	.email-header {
		padding: 1.5rem 2rem;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.sender-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.sender-name {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--color-text, var(--ink));
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.online-indicator {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #10b981;
	}

	.sender-email {
		font-size: 0.875rem;
		color: var(--color-text-muted, var(--ink-muted));
		margin: 0;
	}

	.header-actions {
		position: relative;
	}

	.content-rule {
		border: none;
		height: 1px;
		background: var(--color-border, var(--border));
		margin: 0;
	}

	/* Dropdown Menu */
	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.5rem;
		width: 180px;
		background: var(--color-bg-elevated, white);
		border: 1px solid var(--color-border, var(--border));
		border-radius: 4px;
		box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.15);
		z-index: 10;
	}

	.dropdown-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary, var(--ink-light));
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		transition: background 0.15s ease;
	}

	.dropdown-item:hover {
		background: var(--color-bg, var(--paper));
	}

	.dropdown-item-danger .dropdown-icon {
		color: var(--coral);
	}

	.dropdown-icon {
		width: 16px;
		height: 16px;
	}

	/* Email Thread */
	.email-thread {
		flex: 1;
		overflow-y: auto;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.email-item {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.email-status-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
	}

	.email-icon {
		width: 18px;
		height: 18px;
		color: var(--coral);
		flex-shrink: 0;
	}

	.email-timestamp {
		color: var(--color-text-secondary, var(--ink-light));
	}

	.email-sequence {
		color: var(--color-text-muted, var(--ink-muted));
	}

	.email-status-label {
		margin-left: auto;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.status-action {
		color: var(--coral);
	}

	.status-responded {
		color: #3b82f6;
	}

	.status-default {
		color: var(--color-text-muted, var(--ink-muted));
	}

	/* Email Content */
	.email-content {
		border: 1px solid var(--color-border, var(--border));
		border-radius: 4px;
		background: var(--color-bg-elevated, white);
	}

	.email-content-header {
		padding: 1.25rem 1.5rem;
	}

	.email-subject {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text, var(--ink));
		margin-bottom: 1rem;
	}

	.email-meta {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.email-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink);
		flex-shrink: 0;
	}

	.email-addresses {
		flex: 1;
		font-size: 0.875rem;
	}

	.email-from {
		margin: 0 0 0.25rem 0;
		color: var(--color-text, var(--ink));
	}

	.email-from strong {
		font-weight: 600;
	}

	.email-from-address {
		color: var(--color-text-secondary, var(--ink-light));
		margin-left: 0.5rem;
	}

	.email-to,
	.email-cc {
		margin: 0;
		color: var(--color-text, var(--ink));
	}

	.address-label {
		color: var(--color-text-muted, var(--ink-muted));
		margin-right: 0.25rem;
	}

	.email-actions {
		display: flex;
		gap: 0.25rem;
	}

	.email-rule {
		border: none;
		height: 1px;
		background: var(--color-border, var(--border));
		margin: 0;
	}

	.email-body {
		padding: 1.25rem 1.5rem;
	}

	.email-body p {
		font-size: 0.9375rem;
		line-height: 1.7;
		color: var(--color-text-secondary, var(--ink-light));
		margin: 0;
	}

	/* Deleted State */
	.deleted-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		text-align: center;
		padding: 2rem;
	}

	.deleted-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--color-bg-hover, var(--paper-warm));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--coral);
	}

	.deleted-icon svg {
		width: 32px;
		height: 32px;
	}

	.deleted-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text, var(--ink));
		margin: 0;
	}

	.deleted-description {
		font-size: 0.875rem;
		color: var(--color-text-muted, var(--ink-muted));
		margin: 0;
	}

	/* Shared Button Styles */
	.icon-btn {
		padding: 0.5rem;
		background: none;
		border: none;
		color: var(--color-text-muted, var(--ink-muted));
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.15s ease;
	}

	.icon-btn:hover {
		color: var(--color-text, var(--ink));
		background: var(--color-bg, var(--paper));
	}

	.icon {
		width: 20px;
		height: 20px;
	}

	/* ================================ */
	/* Outreach Status View */
	/* ================================ */
	.outreach-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 2rem;
		overflow-y: auto;
		max-width: 1200px;
		margin: 0 auto;
		width: 100%;
	}

	/* Stats Row */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.stat-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		background: var(--color-bg-elevated, white);
		border: 1px solid var(--color-border, var(--border));
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		font-family: inherit;
		text-align: left;
	}

	.stat-card:hover {
		border-color: var(--color-text-muted, var(--ink-muted));
	}

	.stat-card-active {
		border-color: var(--coral);
		box-shadow: 0 0 0 1px var(--coral);
	}

	.stat-icon {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.stat-icon svg {
		width: 24px;
		height: 24px;
	}

	.stat-icon-queued {
		background: #fef3c7;
		color: #92400e;
	}

	.stat-icon-processing {
		background: #dbeafe;
		color: #1e40af;
	}

	.stat-icon-sent {
		background: #dcfce7;
		color: #166534;
	}

	.stat-icon-failed {
		background: #fee2e2;
		color: #991b1b;
	}

	:global([data-theme="dark"]) .stat-icon-queued {
		background: rgba(234, 179, 8, 0.2);
		color: #fbbf24;
	}

	:global([data-theme="dark"]) .stat-icon-processing {
		background: rgba(59, 130, 246, 0.2);
		color: #60a5fa;
	}

	:global([data-theme="dark"]) .stat-icon-sent {
		background: rgba(34, 197, 94, 0.2);
		color: #4ade80;
	}

	:global([data-theme="dark"]) .stat-icon-failed {
		background: rgba(239, 68, 68, 0.2);
		color: #f87171;
	}

	.stat-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text, var(--ink));
	}

	.stat-label {
		font-size: 0.875rem;
		color: var(--color-text-muted, var(--ink-muted));
	}

	/* Filter Pills */
	.filter-pills {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.filter-pill {
		padding: 0.5rem 1rem;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		border: 1px solid var(--color-border, var(--border));
		border-radius: 100px;
		background: var(--color-bg-elevated, white);
		color: var(--color-text-secondary, var(--ink-light));
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.filter-pill:hover {
		border-color: var(--color-text-muted, var(--ink-muted));
	}

	.filter-pill-active {
		background: var(--color-text, var(--ink));
		border-color: var(--color-text, var(--ink));
		color: var(--color-bg-elevated, white);
	}

	/* Queue List */
	.queue-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.queue-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: var(--color-bg-elevated, white);
		border: 1px solid var(--color-border, var(--border));
		border-radius: 6px;
		transition: background 0.15s ease;
	}

	.queue-item:hover {
		background: var(--color-bg-hover, var(--paper-warm));
	}

	.queue-item-main {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex: 1;
		min-width: 0;
	}

	.queue-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink);
		flex-shrink: 0;
	}

	.queue-content {
		flex: 1;
		min-width: 0;
	}

	.queue-recipient {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.recipient-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text, var(--ink));
	}

	.recipient-email {
		font-size: 0.75rem;
		color: var(--color-text-muted, var(--ink-muted));
	}

	.queue-subject {
		font-size: 0.8125rem;
		color: var(--color-text-secondary, var(--ink-light));
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		flex-shrink: 0;
		margin-left: 1rem;
	}

	.queue-status {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 0.625rem;
		border-radius: 100px;
	}

	.queue-status-sent {
		background: #dcfce7;
		color: #166534;
	}

	.queue-status-queued {
		background: #fef3c7;
		color: #92400e;
	}

	.queue-status-processing {
		background: #dbeafe;
		color: #1e40af;
	}

	.queue-status-failed {
		background: #fee2e2;
		color: #991b1b;
	}

	.queue-status-cancelled {
		background: var(--color-border, var(--border));
		color: var(--color-text-muted, var(--ink-muted));
	}

	:global([data-theme="dark"]) .queue-status-sent {
		background: rgba(34, 197, 94, 0.2);
		color: #4ade80;
	}

	:global([data-theme="dark"]) .queue-status-queued {
		background: rgba(234, 179, 8, 0.2);
		color: #fbbf24;
	}

	:global([data-theme="dark"]) .queue-status-processing {
		background: rgba(59, 130, 246, 0.2);
		color: #60a5fa;
	}

	:global([data-theme="dark"]) .queue-status-failed {
		background: rgba(239, 68, 68, 0.2);
		color: #f87171;
	}

	.queue-time {
		font-size: 0.75rem;
		color: var(--color-text-muted, var(--ink-muted));
	}

	.queue-item-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: 1.5rem;
	}

	.action-btn {
		padding: 0.375rem 0.875rem;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.action-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.action-btn-retry {
		background: var(--coral);
		color: white;
		border: none;
	}

	.action-btn-retry:hover:not(:disabled) {
		background: var(--coral-dark);
	}

	.action-btn-cancel {
		background: transparent;
		color: var(--color-text-secondary, var(--ink-light));
		border: 1px solid var(--color-border, var(--border));
	}

	.action-btn-cancel:hover:not(:disabled) {
		border-color: var(--coral);
		color: var(--coral);
	}

	.action-btn-info {
		padding: 0.375rem;
		background: transparent;
		border: none;
		color: var(--color-text-muted, var(--ink-muted));
	}

	.action-btn-info:hover {
		color: var(--color-text, var(--ink));
	}

	.action-btn-info svg {
		width: 18px;
		height: 18px;
	}

	.scheduled-time {
		font-size: 0.75rem;
		color: var(--color-text-muted, var(--ink-muted));
	}

	.processing-indicator {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: #1e40af;
	}

	:global([data-theme="dark"]) .processing-indicator {
		color: #60a5fa;
	}

	/* Error Tooltip */
	.error-tooltip-wrapper {
		position: relative;
	}

	.error-tooltip {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: var(--color-text, var(--ink));
		color: var(--color-bg-elevated, white);
		font-size: 0.75rem;
		line-height: 1.4;
		border-radius: 4px;
		white-space: nowrap;
		max-width: 300px;
		white-space: normal;
		z-index: 10;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.error-tooltip::after {
		content: '';
		position: absolute;
		top: 100%;
		right: 12px;
		border: 6px solid transparent;
		border-top-color: var(--color-text, var(--ink));
	}

	/* Spinner */
	.spinner {
		animation: spin 1.5s linear infinite;
	}

	.spinner-small {
		width: 16px;
		height: 16px;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.empty-icon {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: var(--color-bg-hover, var(--paper-warm));
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 1.5rem;
	}

	.empty-icon svg {
		width: 40px;
		height: 40px;
		color: var(--color-text-muted, var(--ink-muted));
	}

	.empty-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text, var(--ink));
		margin: 0 0 0.5rem 0;
	}

	.empty-description {
		font-size: 0.875rem;
		color: var(--color-text-muted, var(--ink-muted));
		margin: 0;
		max-width: 320px;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
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
		max-width: 400px;
		background: var(--color-bg-elevated, white);
		border-radius: 4px;
		padding: 2rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	}

	.modal-icon {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--color-bg-hover, var(--paper-warm));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--coral);
		margin-bottom: 1.5rem;
	}

	.modal-icon svg {
		width: 24px;
		height: 24px;
	}

	.modal-icon-info {
		color: var(--color-text, var(--ink));
	}

	.modal-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--color-text, var(--ink));
		margin: 0 0 0.75rem 0;
	}

	.modal-description {
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--color-text-secondary, var(--ink-light));
		margin: 0 0 2rem 0;
	}

	.modal-actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.modal-actions-right {
		justify-content: flex-end;
		flex-direction: row;
	}

	/* Buttons */
	.btn {
		padding: 0.875rem 1.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		font-family: inherit;
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: center;
	}

	.btn-primary {
		background: var(--coral);
		color: white;
		border: none;
	}

	.btn-primary:hover {
		background: var(--coral-dark);
	}

	.btn-secondary {
		background: var(--color-bg-elevated, white);
		color: var(--color-text-secondary, var(--ink-light));
		border: 1px solid var(--color-border, var(--border));
	}

	.btn-secondary:hover {
		border-color: var(--color-text-muted, var(--ink-muted));
		color: var(--color-text, var(--ink));
	}

	/* Avatar Colors */
	.bg-coral {
		background: #FFCDC8;
	}

	.bg-amber-200 {
		background: #FDE68A;
	}

	.bg-purple-200 {
		background: #E9D5FF;
	}

	.bg-blue-200 {
		background: #BFDBFE;
	}

	.bg-orange-100 {
		background: #FFEDD5;
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.contact-panel {
			width: 280px;
		}

		.stats-row {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.page-header {
			padding: 1rem;
		}

		.header-content {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.main-tabs {
			width: 100%;
		}

		.main-tab {
			flex: 1;
			text-align: center;
		}

		.replies-view {
			flex-direction: column;
		}

		.contact-panel {
			width: 100%;
			max-height: 40vh;
		}

		.email-panel {
			flex: 1;
		}

		.email-thread {
			padding: 1rem;
		}

		.email-header {
			padding: 1rem;
		}

		.outreach-view {
			padding: 1rem;
		}

		.stats-row {
			grid-template-columns: 1fr 1fr;
		}

		.stat-card {
			padding: 1rem;
		}

		.stat-icon {
			width: 40px;
			height: 40px;
		}

		.stat-icon svg {
			width: 20px;
			height: 20px;
		}

		.stat-value {
			font-size: 1.25rem;
		}

		.queue-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.queue-item-main {
			width: 100%;
		}

		.queue-meta {
			flex-direction: row;
			margin-left: auto;
		}

		.queue-item-actions {
			width: 100%;
			margin-left: 0;
			justify-content: flex-end;
		}

		.modal-actions {
			flex-direction: column;
		}

		.modal-actions-right {
			flex-direction: column;
		}
	}

	@media (max-width: 480px) {
		.stats-row {
			grid-template-columns: 1fr;
		}

		.filter-pills {
			overflow-x: auto;
			flex-wrap: nowrap;
			padding-bottom: 0.5rem;
		}

		.filter-pill {
			flex-shrink: 0;
		}
	}
</style>
