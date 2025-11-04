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
			avatarColor: 'bg-[#FCD5B5]'
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
			avatarColor: 'bg-[#FCD5B5]'
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
			avatarColor: 'bg-[#FCD5B5]'
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
			avatarColor: 'bg-[#FCD5B5]'
		}
	];

	const contacts: Contact[] = [
		{ id: '1', name: 'Michael Lee', preview: 'See you all in a bit!', time: '7:12 AM', avatarColor: 'bg-[#E7D6FF]' },
		{ id: '2', name: 'Jessica Chen', preview: 'Looking forward to it!', time: '7:30 AM', avatarColor: 'bg-[#FCD5B5]' },
		{ id: '3', name: 'David Wong', preview: 'I\'ll be there right on time.', time: '7:45 AM', avatarColor: 'bg-[#FFB4A8]' },
		{ id: '4', name: 'Emily Davis', preview: 'Can\'t wait to discuss!', time: '8:00 AM', avatarColor: 'bg-[#FCD5B5]' },
		{ id: '5', name: 'Chris Johnson', preview: 'Sounds good, see you!', time: '8:15 AM', avatarColor: 'bg-[#FEE4C2]' },
		{ id: '6', name: 'Katie Smith', preview: 'I\'ll grab coffee before the meeting.', time: '8:30 AM', avatarColor: 'bg-[#E7D6FF]' },
		{ id: '7', name: 'Ryan Brown', preview: 'Ready to dive in!', time: '8:45 AM', avatarColor: 'bg-[#C7E8FF]' },
		{ id: '8', name: 'Lucy Green', preview: 'Just finished my prep!', time: '9:00 AM', avatarColor: 'bg-[#FFB4A8]' }
	];

let viewFilter = $state<'all' | 'interested' | 'not_interested'>('all');
let searchTerm = $state('');
let selectedEmailId = $state<string>(emails[0].id);
let overflowOpen = $state(false);
let deleteModalOpen = $state(false);
let deletedConversationIds = $state<string[]>([]);

	const selectedEmail = $derived(emails.find((email) => email.id === selectedEmailId) ?? emails[0]);
	const isDeleted = $derived(deletedConversationIds.includes(selectedEmailId));

	function getStatusColor(status?: string) {
		if (status === 'action_required') return 'text-[#FF6F61]';
		if (status === 'responded') return 'text-blue-500';
		return 'text-gray-500';
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
</script>

<div class="flex h-screen bg-gray-50">
	<!-- Middle Panel - Contact List -->
	<div class="flex w-[320px] flex-col border-r border-gray-200 bg-white">
		<!-- Header -->
		<div class="border-b border-gray-200 px-6 py-5">
			<div class="flex items-center justify-between">
				<h1 class="text-2xl font-semibold text-gray-900">Inbox</h1>
				<button type="button" class="text-gray-400 hover:text-gray-600" aria-label="Inbox options">
					<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
						<path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Search Bar -->
		<div class="border-b border-gray-100 px-4 py-3">
			<div class="relative">
				<svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.35-4.35" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<input
					type="search"
					placeholder="Search influencer or email"
					class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
					bind:value={searchTerm}
				/>
			</div>
		</div>

		<!-- Filter Tabs -->
		<div class="border-b border-gray-100 px-4 py-3">
			<div class="flex gap-2">
				{#each [{ value: 'all', label: 'All replies' }, { value: 'interested', label: 'Interested' }, { value: 'not_interested', label: 'Not interested' }] as tab}
					<button
						type="button"
						onclick={() => (viewFilter = tab.value as typeof viewFilter)}
						class="rounded-full border px-4 py-1.5 text-xs font-medium transition {viewFilter === tab.value
							? 'border-gray-900 bg-gray-900 text-white'
							: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Contact List -->
		<div class="flex-1 overflow-y-auto">
			{#each contacts as contact}
				<button
					type="button"
					class={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-4 text-left transition hover:bg-gray-50 ${
						contact.id === selectedEmailId ? 'bg-[#FFF5F3]' : ''
					}`}
					onclick={() => handleSelectContact(contact.id)}
					aria-pressed={contact.id === selectedEmailId ? 'true' : 'false'}
				>
					<div class="{contact.avatarColor} flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-900">
						{contact.name[0]}
					</div>
					<div class="flex-1 overflow-hidden">
						<div class="flex items-start justify-between gap-2">
							<p class="text-sm font-semibold text-gray-900">{contact.name}</p>
							<span class="text-xs text-gray-400">{contact.time}</span>
						</div>
						<p class="mt-0.5 truncate text-xs text-gray-500">{contact.preview}</p>
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Right Panel - Email Content -->
	<div class="flex flex-1 flex-col bg-white">
		<!-- Email Header -->
		<div class="border-b border-gray-200 px-8 py-6">
			<div class="flex items-start justify-between">
				<div>
					<div class="flex items-center gap-2">
						<h2 class="text-xl font-semibold text-gray-900">{selectedEmail.from}</h2>
						<span class="h-2 w-2 rounded-full bg-green-500"></span>
					</div>
					<p class="mt-1 text-sm text-gray-500">{selectedEmail.fromEmail}</p>
				</div>
				<div class="relative">
					<button
						type="button"
						class="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Conversation menu"
						onclick={toggleOverflow}
					>
						<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
							<path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
						</svg>
					</button>

					{#if overflowOpen}
						<div class="absolute right-0 mt-2 w-48 rounded-2xl border border-gray-100 bg-white py-2 shadow-xl">
							<button
								type="button"
								class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
								onclick={openDeleteModal}
							>
								<svg class="h-4 w-4 text-[#FF6F61]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
								Delete conversation
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Email Thread -->
		{#if isDeleted}
			<div class="flex flex-1 flex-col items-center justify-center gap-4 text-center text-gray-500">
				<div class="flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF1ED] text-[#FF6F61]">
					<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2.5 2.5" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0z" />
					</svg>
				</div>
				<div>
					<h3 class="text-lg font-semibold text-gray-900">This conversation has been deleted.</h3>
					<p class="text-sm text-gray-500">You can start a new conversation anytime.</p>
				</div>
			</div>
		{:else}
			<div class="flex-1 overflow-y-auto px-8 py-6">
				<div class="space-y-8">
					{#each emails as email}
						<div class="group">
							<!-- Email Status Header -->
							<div class="mb-3 flex items-center gap-2 text-sm">
								<svg class="h-5 w-5 text-[#FF6F61]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
								</svg>
								<span class="text-gray-600">
									{email.timestamp}
									{#if email.sequence}
										<span class="text-gray-400"> {email.sequence}</span>
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
									<span class="ml-auto text-sm font-medium {getStatusColor(email.status)}">{getStatusLabel(email.status)}</span>
								{/if}
							</div>

							<!-- Email Card -->
							<div class="rounded-lg border border-gray-200 bg-white">
								<!-- Email Meta -->
								<div class="border-b border-gray-100 px-6 py-4">
									<div class="mb-3 text-lg font-semibold text-gray-900">{email.subject}</div>
									<div class="flex items-start gap-3">
										<div class="{email.avatarColor} flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-900">
											{email.from[0]}
										</div>
										<div class="flex-1 text-sm">
											<div class="font-semibold text-gray-900">{email.from} <span class="font-normal text-gray-500">{email.fromEmail}</span></div>
											<div class="mt-1 flex items-center gap-1">
												<span class="text-gray-500">To:</span>
												<span class="text-gray-900">{email.to}</span>
											</div>
											{#if email.cc}
												<div class="mt-0.5 flex items-center gap-1">
													<span class="text-gray-500">cc:</span>
													<span class="text-gray-900">{email.cc}</span>
												</div>
											{/if}
										</div>
										<div class="flex gap-2">
											<button type="button" class="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Reply">
												<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
												</svg>
											</button>
											<button type="button" class="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Forward">
												<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
												</svg>
											</button>
											<button type="button" class="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="More">
												<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
													<path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
												</svg>
											</button>
										</div>
									</div>
								</div>

								<!-- Email Body -->
								<div class="px-6 py-5">
									<p class="text-sm leading-relaxed text-gray-700">{email.body}</p>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

{#if deleteModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
		<button
			type="button"
			class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
			aria-label="Close delete dialog"
			onclick={cancelDelete}
		></button>
		<div class="relative w-full max-w-md rounded-[28px] border border-gray-100 bg-white p-8 text-left shadow-[0_25px_70px_-30px_rgba(15,23,42,0.45)]">
			<div class="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF1ED] text-[#FF6F61]">
				<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</div>
			<h3 class="mt-6 text-2xl font-semibold text-gray-900">Delete this conversation?</h3>
			<p class="mt-2 text-sm text-gray-500">
				This removes the messages from your Penny inbox. Influencer replies will still stay in their inbox.
			</p>
			<div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
				<button
					type="button"
					class="flex-1 rounded-2xl bg-[#FF6F61] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#ff846f]"
					onclick={confirmDelete}
				>
					Delete conversation
				</button>
				<button
					type="button"
					class="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
					onclick={cancelDelete}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
