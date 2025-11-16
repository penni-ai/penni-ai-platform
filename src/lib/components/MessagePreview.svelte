<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	
	interface Props {
		open: boolean;
		messageContent: string;
		platform: 'instagram' | 'tiktok';
		recipientName?: string;
		onClose: () => void;
	}
	
	let { open, messageContent, platform, recipientName, onClose }: Props = $props();
	
	// Convert HTML to plain text with newlines preserved
	function htmlToPlainText(html: string): string {
		// Create a temporary div to parse HTML
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = html;
		
		// Replace <br> and <br/> with newlines
		const breaks = tempDiv.querySelectorAll('br');
		breaks.forEach(br => {
			br.replaceWith('\n');
		});
		
		// Replace <p> tags with newlines (paragraph breaks)
		const paragraphs = tempDiv.querySelectorAll('p');
		paragraphs.forEach((p, index) => {
			if (index > 0) {
				p.insertAdjacentText('beforebegin', '\n');
			}
			// Remove the <p> tag but keep content
			const content = p.textContent || '';
			p.replaceWith(content);
		});
		
		// Get plain text content
		let text = tempDiv.textContent || tempDiv.innerText || '';
		
		// Clean up multiple consecutive newlines (max 2)
		text = text.replace(/\n{3,}/g, '\n\n');
		
		// Trim leading/trailing whitespace
		text = text.trim();
		
		return text;
	}
	
	// Replace template variables and convert HTML to plain text
	const processedContent = $derived.by(() => {
		let content = messageContent.replace(/\{\{influencer_name\}\}/g, recipientName || 'John Doe');
		// Convert HTML to plain text with newlines
		content = htmlToPlainText(content);
		return content;
	});
	
	const platformName = $derived(platform === 'instagram' ? 'Instagram' : 'TikTok');
	const platformColor = $derived(platform === 'instagram' ? '#E4405F' : '#000000');
</script>

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close preview"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="border-b border-gray-200 px-6 py-4 shrink-0 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="w-8 h-8 rounded-full flex items-center justify-center" style="background-color: {platformColor}20;">
						{#if platform === 'instagram'}
							<svg class="w-5 h-5" style="color: {platformColor};" fill="currentColor" viewBox="0 0 24 24">
								<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
							</svg>
						{:else}
							<svg class="w-5 h-5" style="color: {platformColor};" fill="currentColor" viewBox="0 0 24 24">
								<path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
							</svg>
						{/if}
					</div>
					<h3 class="text-xl font-semibold text-gray-900">{platformName} Message Preview</h3>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label="Close"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			
			<!-- Preview Content -->
			<div class="flex-1 overflow-y-auto p-6">
				<div class="max-w-sm mx-auto">
					<!-- Mock {platformName} Chat Interface -->
					<div class="bg-gray-50 rounded-2xl p-4 border border-gray-200">
						<div class="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200">
							<div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center">
								<span class="text-gray-600 text-sm font-medium">{recipientName?.charAt(0) || 'J'}</span>
							</div>
							<div>
								<p class="text-sm font-semibold text-gray-900">{recipientName || 'John Doe'}</p>
								<p class="text-xs text-gray-500">@{platform === 'instagram' ? 'instagram' : 'tiktok'}_user</p>
							</div>
						</div>
						
						<!-- Message Bubble -->
						<div class="bg-white rounded-2xl rounded-tl-sm p-4 shadow-sm border border-gray-200">
							<div class="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
								{processedContent}
							</div>
						</div>
						
						<div class="mt-3 flex items-center gap-4 text-xs text-gray-400">
							<span>Now</span>
							<div class="flex items-center gap-1">
								<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
									<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
									<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
								</svg>
								<span>Seen</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

