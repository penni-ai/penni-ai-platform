<script lang="ts">
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

	let viewFilter = $state<'all' | 'interested' | 'not_interested'>('all');
	let searchTerm = $state('');
	let selectedEmailId = $state<string>(emails[0].id);
	let overflowOpen = $state(false);
	let deleteModalOpen = $state(false);
	let deletedConversationIds = $state<string[]>([]);
	let mockupPreviewOpen = $state(true);

	const selectedEmail = $derived(emails.find((email) => email.id === selectedEmailId) ?? emails[0]);
	const isDeleted = $derived(deletedConversationIds.includes(selectedEmailId));

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

	function closeMockupPreview() {
		mockupPreviewOpen = false;
	}
</script>

<div class="inbox-page">
	<!-- Contact List Panel -->
	<aside class="contact-panel">
		<header class="contact-header">
			<h1 class="panel-title">Inbox</h1>
			<button type="button" class="icon-btn" aria-label="Inbox options">
				<svg class="icon" fill="currentColor" viewBox="0 0 20 20">
					<path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
				</svg>
			</button>
		</header>

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

<!-- Mockup Preview Popup -->
{#if mockupPreviewOpen}
	<div class="modal-backdrop">
		<button
			type="button"
			class="backdrop-close"
			aria-label="Close preview dialog"
			onclick={closeMockupPreview}
		></button>
		<div class="modal-content">
			<div class="modal-icon modal-icon-info">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
				</svg>
			</div>
			<h3 class="modal-title">Mockup Preview</h3>
			<p class="modal-description">
				This is just a mockup preview.
			</p>
			<div class="modal-actions modal-actions-right">
				<button
					type="button"
					class="btn btn-primary"
					onclick={closeMockupPreview}
				>
					Got it
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
		height: 100vh;
		background: var(--paper);
		color: var(--ink);
	}

	/* Contact Panel */
	.contact-panel {
		width: 340px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border);
		background: white;
	}

	.contact-header {
		padding: 1.5rem 1.5rem 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.75rem;
		font-weight: 400;
		color: var(--ink);
	}

	/* Search */
	.search-container {
		position: relative;
		padding: 0 1.5rem 1rem;
	}

	.search-icon {
		position: absolute;
		left: 2rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: var(--ink-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.625rem 1rem 0.625rem 2.25rem;
		font-size: 0.875rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--paper);
		color: var(--ink);
		font-family: inherit;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--coral);
	}

	.search-input::placeholder {
		color: var(--ink-muted);
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
		border: 1px solid var(--border);
		border-radius: 2px;
		background: white;
		color: var(--ink-light);
		cursor: pointer;
		transition: all 0.2s ease;
		font-family: inherit;
	}

	.filter-tab:hover {
		border-color: var(--ink-muted);
	}

	.filter-tab-active {
		background: var(--ink);
		border-color: var(--ink);
		color: white;
	}

	.panel-rule {
		border: none;
		height: 1px;
		background: var(--border);
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
		background: white;
		border: none;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		transition: background 0.15s ease;
		font-family: inherit;
	}

	.contact-item:hover {
		background: var(--paper);
	}

	.contact-item-active {
		background: var(--paper-warm);
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
		color: var(--ink);
	}

	.contact-time {
		font-size: 0.75rem;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.contact-preview {
		font-size: 0.8125rem;
		color: var(--ink-light);
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
		background: white;
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
		color: var(--ink);
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
		color: var(--ink-muted);
		margin: 0;
	}

	.header-actions {
		position: relative;
	}

	.content-rule {
		border: none;
		height: 1px;
		background: var(--border);
		margin: 0;
	}

	/* Dropdown Menu */
	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.5rem;
		width: 180px;
		background: white;
		border: 1px solid var(--border);
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
		color: var(--ink-light);
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		transition: background 0.15s ease;
	}

	.dropdown-item:hover {
		background: var(--paper);
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
		color: var(--ink-light);
	}

	.email-sequence {
		color: var(--ink-muted);
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
		color: var(--ink-muted);
	}

	/* Email Content */
	.email-content {
		border: 1px solid var(--border);
		border-radius: 4px;
		background: white;
	}

	.email-content-header {
		padding: 1.25rem 1.5rem;
	}

	.email-subject {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--ink);
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
		color: var(--ink);
	}

	.email-from strong {
		font-weight: 600;
	}

	.email-from-address {
		color: var(--ink-light);
		margin-left: 0.5rem;
	}

	.email-to,
	.email-cc {
		margin: 0;
		color: var(--ink);
	}

	.address-label {
		color: var(--ink-muted);
		margin-right: 0.25rem;
	}

	.email-actions {
		display: flex;
		gap: 0.25rem;
	}

	.email-rule {
		border: none;
		height: 1px;
		background: var(--border);
		margin: 0;
	}

	.email-body {
		padding: 1.25rem 1.5rem;
	}

	.email-body p {
		font-size: 0.9375rem;
		line-height: 1.7;
		color: var(--ink-light);
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
		background: var(--paper-warm);
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
		color: var(--ink);
		margin: 0;
	}

	.deleted-description {
		font-size: 0.875rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Shared Button Styles */
	.icon-btn {
		padding: 0.5rem;
		background: none;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.15s ease;
	}

	.icon-btn:hover {
		color: var(--ink);
		background: var(--paper);
	}

	.icon {
		width: 20px;
		height: 20px;
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
		background: white;
		border-radius: 4px;
		padding: 2rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	}

	.modal-icon {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--paper-warm);
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
		color: var(--ink);
	}

	.modal-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0 0 0.75rem 0;
	}

	.modal-description {
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--ink-light);
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
		background: white;
		color: var(--ink-light);
		border: 1px solid var(--border);
	}

	.btn-secondary:hover {
		border-color: var(--ink-muted);
		color: var(--ink);
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
	}

	@media (max-width: 768px) {
		.inbox-page {
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

		.modal-actions {
			flex-direction: column;
		}

		.modal-actions-right {
			flex-direction: column;
		}
	}
</style>
