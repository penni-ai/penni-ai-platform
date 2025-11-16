<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	
	interface Props {
		open: boolean;
		emailContent: string;
		recipientName?: string;
		recipientEmail?: string;
		onClose: () => void;
	}
	
	let { open, emailContent, recipientName, recipientEmail, onClose }: Props = $props();
	
	// Convert HTML content to email-safe HTML with proper styling
	const getEmailHTML = (content: string): string => {
		// Replace template variables with sample data
		let processedContent = content
			.replace(/\{\{influencer_name\}\}/g, recipientName || 'John Doe');
		
		// Wrap in email-safe HTML structure
		return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			font-size: 14px;
			line-height: 1.6;
			color: #333333;
			background-color: #f5f5f5;
			margin: 0;
			padding: 20px;
		}
		.email-container {
			max-width: 600px;
			margin: 0 auto;
			background-color: #ffffff;
			border: 1px solid #e0e0e0;
			border-radius: 8px;
			overflow: hidden;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		}
		.email-header {
			background-color: #f8f9fa;
			border-bottom: 1px solid #e0e0e0;
			padding: 16px 20px;
		}
		.email-header-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
		}
		.email-header-label {
			font-size: 12px;
			color: #666666;
			font-weight: 600;
			min-width: 60px;
		}
		.email-header-value {
			font-size: 14px;
			color: #333333;
			flex: 1;
		}
		.email-body {
			padding: 24px 20px;
		}
		.email-body h1,
		.email-body h2,
		.email-body h3 {
			margin-top: 0;
			margin-bottom: 16px;
			font-weight: 600;
			color: #1a1a1a;
		}
		.email-body h1 {
			font-size: 24px;
		}
		.email-body h2 {
			font-size: 20px;
		}
		.email-body h3 {
			font-size: 18px;
		}
		.email-body p {
			margin: 0 0 16px 0;
		}
		.email-body ul,
		.email-body ol {
			margin: 0 0 16px 0;
			padding-left: 24px;
		}
		.email-body li {
			margin: 4px 0;
		}
		.email-body strong {
			font-weight: 600;
		}
		.email-body em {
			font-style: italic;
		}
		.email-body a {
			color: #FF6F61;
			text-decoration: none;
		}
		.email-body a:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="email-container">
		<div class="email-header">
			<div class="email-header-row">
				<span class="email-header-label">From:</span>
				<span class="email-header-value">you@yourcompany.com</span>
			</div>
			<div class="email-header-row">
				<span class="email-header-label">To:</span>
				<span class="email-header-value">${recipientEmail || 'recipient@example.com'}</span>
			</div>
			<div class="email-header-row">
				<span class="email-header-label">Subject:</span>
				<span class="email-header-value">Partnership Opportunity</span>
			</div>
		</div>
		<div class="email-body">
			${processedContent}
		</div>
	</div>
</body>
</html>
		`.trim();
	};
	
	let iframeRef = $state<HTMLIFrameElement | null>(null);
	
	// Update iframe content when emailContent changes
	$effect(() => {
		if (iframeRef && open && emailContent) {
			const iframe = iframeRef;
			const doc = iframe.contentDocument || iframe.contentWindow?.document;
			if (doc) {
				doc.open();
				doc.write(getEmailHTML(emailContent));
				doc.close();
			}
		}
	});
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
			class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] mx-4 flex flex-col"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="border-b border-gray-200 px-6 py-4 shrink-0 flex items-center justify-between">
				<h3 class="text-xl font-semibold text-gray-900">Email Preview</h3>
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
			<div class="flex-1 overflow-hidden">
				<iframe
					bind:this={iframeRef}
					class="w-full h-full border-0"
					sandbox="allow-same-origin"
					title="Email preview"
				></iframe>
			</div>
		</div>
	</div>
{/if}

