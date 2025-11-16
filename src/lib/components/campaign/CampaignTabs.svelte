<script lang="ts">
	interface Props {
		activeTab: 'chat' | 'outreach';
		hasUserMessages: boolean;
		onTabChange: (tab: 'chat' | 'outreach') => void;
	}

	let { activeTab, hasUserMessages, onTabChange }: Props = $props();

	function handleChatClick() {
		onTabChange('chat');
	}

	function handleOutreachClick() {
		onTabChange('outreach');
	}
</script>

<div class="border-b border-gray-200 bg-white px-8 pt-6">
	<div class="flex gap-1">
		<button
			type="button"
			onclick={handleChatClick}
			class={`px-4 py-2 text-sm font-medium transition ${
				activeTab === 'chat'
					? 'border-b-2 border-[#FF6F61] text-gray-900'
					: 'text-gray-500 hover:text-gray-700'
			}`}
		>
			Chat
		</button>
		{#if hasUserMessages}
			<button
				type="button"
				onclick={handleOutreachClick}
				class={`px-4 py-2 text-sm font-medium transition ${
					activeTab === 'outreach'
						? 'border-b-2 border-[#FF6F61] text-gray-900'
						: 'text-gray-500 hover:text-gray-700'
				}`}
			>
				Outreach
			</button>
		{/if}
	</div>
</div>

