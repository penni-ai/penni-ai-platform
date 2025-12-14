<script lang="ts">
	interface Props {
		open: boolean;
		userName?: string;
		onGetStarted: () => void;
		onClose: () => void;
	}

	let { open, userName = '', onGetStarted, onClose }: Props = $props();

	function handleGetStarted() {
		onGetStarted();
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="backdrop" onclick={handleBackdropClick} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
			<!-- Decorative corner accents -->
			<div class="corner corner-tl"></div>
			<div class="corner corner-br"></div>

			<button class="close-btn" onclick={onClose} aria-label="Close">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M6 18L18 6M6 6l12 12"/>
				</svg>
			</button>

			<div class="content">
				<!-- Hero section -->
				<div class="hero">
					<span class="eyebrow">Welcome aboard</span>
					<h1 id="welcome-title">
						{#if userName}
							Hello, {userName}
						{:else}
							Let's get started
						{/if}
					</h1>
					<p class="tagline">Your influencer marketing journey begins here.</p>
				</div>

				<!-- Steps -->
				<div class="steps">
					<div class="step" style="--delay: 0.1s">
						<div class="step-marker">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 4v16m-8-8h16"/>
							</svg>
						</div>
						<div class="step-content">
							<h3>Create a campaign</h3>
							<p>Tell us about your brand & ideal creators</p>
						</div>
					</div>
					<div class="step" style="--delay: 0.2s">
						<div class="step-marker">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="11" cy="11" r="7"/>
								<path d="m21 21-4.35-4.35"/>
							</svg>
						</div>
						<div class="step-content">
							<h3>Discover influencers</h3>
							<p>AI-powered matching finds your perfect fit</p>
						</div>
					</div>
					<div class="step" style="--delay: 0.3s">
						<div class="step-marker">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
							</svg>
						</div>
						<div class="step-content">
							<h3>Send outreach</h3>
							<p>Personalized emails that get responses</p>
						</div>
					</div>
				</div>

				<!-- CTA -->
				<button class="cta-btn" onclick={handleGetStarted}>
					<span class="cta-text">Create Your First Campaign</span>
					<span class="cta-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M5 12h14M12 5l7 7-7 7"/>
						</svg>
					</span>
				</button>

				<p class="hint">Takes less than 2 minutes</p>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 20, 18, 0.7);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1.5rem;
		animation: fadeIn 0.3s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal {
		position: relative;
		background: linear-gradient(145deg, #fffdf9 0%, #fff8f0 100%);
		border-radius: 20px;
		width: 100%;
		max-width: 460px;
		box-shadow:
			0 0 0 1px rgba(255, 111, 97, 0.1),
			0 4px 6px rgba(0, 0, 0, 0.05),
			0 20px 50px rgba(0, 0, 0, 0.15),
			0 40px 80px rgba(255, 111, 97, 0.08);
		overflow: hidden;
		animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/* Decorative corners */
	.corner {
		position: absolute;
		width: 80px;
		height: 80px;
		pointer-events: none;
	}

	.corner-tl {
		top: 0;
		left: 0;
		background: linear-gradient(135deg, rgba(255, 111, 97, 0.12) 0%, transparent 60%);
	}

	.corner-br {
		bottom: 0;
		right: 0;
		background: linear-gradient(-45deg, rgba(255, 111, 97, 0.08) 0%, transparent 60%);
	}

	.close-btn {
		position: absolute;
		top: 1.25rem;
		right: 1.25rem;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		cursor: pointer;
		color: #8a8a8a;
		transition: all 0.2s ease;
		z-index: 10;
	}

	.close-btn:hover {
		background: rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.12);
		color: #1a1a1a;
		transform: scale(1.05);
	}

	.close-btn svg {
		width: 16px;
		height: 16px;
	}

	.content {
		padding: 2.5rem 2rem 2rem;
	}

	/* Hero section */
	.hero {
		text-align: center;
		margin-bottom: 2rem;
	}

	.eyebrow {
		display: inline-block;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: #FF6F61;
		margin-bottom: 0.75rem;
	}

	h1 {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		color: #1a1a1a;
		margin: 0 0 0.5rem 0;
		line-height: 1.2;
	}

	.tagline {
		font-size: 1rem;
		color: #6a6a6a;
		margin: 0;
		line-height: 1.5;
	}

	/* Steps */
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 2rem;
	}

	.step {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 0.875rem 1rem;
		background: rgba(255, 255, 255, 0.7);
		border: 1px solid rgba(0, 0, 0, 0.04);
		border-radius: 12px;
		transition: all 0.2s ease;
		animation: stepFadeIn 0.5s ease-out backwards;
		animation-delay: var(--delay);
	}

	@keyframes stepFadeIn {
		from {
			opacity: 0;
			transform: translateX(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.step:hover {
		background: rgba(255, 255, 255, 0.95);
		border-color: rgba(255, 111, 97, 0.15);
		transform: translateX(4px);
	}

	.step-marker {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background: linear-gradient(135deg, #FF6F61 0%, #ff8a7a 100%);
		border-radius: 12px;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 12px rgba(255, 111, 97, 0.3);
	}

	.step-marker svg {
		width: 18px;
		height: 18px;
	}

	.step-content {
		flex: 1;
		min-width: 0;
	}

	.step-content h3 {
		font-family: 'DM Sans', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		color: #1a1a1a;
		margin: 0 0 0.125rem 0;
	}

	.step-content p {
		font-size: 0.8125rem;
		color: #6a6a6a;
		margin: 0;
		line-height: 1.4;
	}

	/* Big CTA Button */
	.cta-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1.125rem 2rem;
		background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
		color: white;
		font-family: 'DM Sans', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 600;
		border: none;
		border-radius: 14px;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		position: relative;
		overflow: hidden;
	}

	.cta-btn::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, #FF6F61 0%, #ff8a7a 100%);
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.cta-btn:hover {
		transform: translateY(-2px);
		box-shadow:
			0 8px 20px rgba(26, 26, 26, 0.25),
			0 4px 8px rgba(255, 111, 97, 0.15);
	}

	.cta-btn:hover::before {
		opacity: 1;
	}

	.cta-btn:active {
		transform: translateY(0);
	}

	.cta-text,
	.cta-icon {
		position: relative;
		z-index: 1;
	}

	.cta-icon {
		display: flex;
		transition: transform 0.3s ease;
	}

	.cta-btn:hover .cta-icon {
		transform: translateX(4px);
	}

	.cta-icon svg {
		width: 20px;
		height: 20px;
	}

	.hint {
		text-align: center;
		font-size: 0.75rem;
		color: #8a8a8a;
		margin: 1rem 0 0 0;
	}

	/* Dark mode support */
	:global([data-theme="dark"]) .modal {
		background: linear-gradient(145deg, #1f1f1f 0%, #171717 100%);
		box-shadow:
			0 0 0 1px rgba(255, 111, 97, 0.15),
			0 20px 50px rgba(0, 0, 0, 0.5),
			0 40px 80px rgba(255, 111, 97, 0.05);
	}

	:global([data-theme="dark"]) .corner-tl {
		background: linear-gradient(135deg, rgba(255, 111, 97, 0.15) 0%, transparent 60%);
	}

	:global([data-theme="dark"]) .corner-br {
		background: linear-gradient(-45deg, rgba(255, 111, 97, 0.1) 0%, transparent 60%);
	}

	:global([data-theme="dark"]) .close-btn {
		border-color: rgba(255, 255, 255, 0.1);
		color: #8a8a8a;
	}

	:global([data-theme="dark"]) .close-btn:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(255, 255, 255, 0.15);
		color: #fff;
	}

	:global([data-theme="dark"]) h1 {
		color: #fff;
	}

	:global([data-theme="dark"]) .tagline {
		color: #9a9a9a;
	}

	:global([data-theme="dark"]) .step {
		background: rgba(255, 255, 255, 0.03);
		border-color: rgba(255, 255, 255, 0.06);
	}

	:global([data-theme="dark"]) .step:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 111, 97, 0.2);
	}

	:global([data-theme="dark"]) .step-content h3 {
		color: #fff;
	}

	:global([data-theme="dark"]) .step-content p {
		color: #9a9a9a;
	}

	:global([data-theme="dark"]) .cta-btn {
		background: linear-gradient(135deg, #FF6F61 0%, #e85d50 100%);
	}

	:global([data-theme="dark"]) .cta-btn::before {
		background: linear-gradient(135deg, #ff8a7a 0%, #FF6F61 100%);
	}

	:global([data-theme="dark"]) .cta-btn:hover {
		box-shadow:
			0 8px 20px rgba(255, 111, 97, 0.3),
			0 4px 8px rgba(0, 0, 0, 0.3);
	}

	:global([data-theme="dark"]) .hint {
		color: #6a6a6a;
	}

	/* Responsive */
	@media (max-width: 480px) {
		.content {
			padding: 2rem 1.5rem 1.5rem;
		}

		h1 {
			font-size: 1.75rem;
		}

		.step {
			padding: 0.75rem;
		}

		.step-marker {
			width: 36px;
			height: 36px;
		}

		.step-marker svg {
			width: 16px;
			height: 16px;
		}
	}
</style>
