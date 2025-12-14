<footer class="footer">
	<div class="footer-inner">
		<!-- Left side: Copyright -->
		<div class="footer-copyright">
			<span class="copyright-text">&copy; {new Date().getFullYear()} Penny</span>
			<span class="copyright-divider">&middot;</span>
			<span class="copyright-tagline">All rights reserved</span>
		</div>

		<!-- Right side: Navigation -->
		<nav class="footer-nav">
			<a href="/" class="footer-link">Home</a>
			<a href="/privacy" class="footer-link">Privacy</a>
			<a href="/terms" class="footer-link">Terms</a>
			<a href="/sign-up" class="footer-link footer-link-accent">Sign up</a>
		</nav>
	</div>
</footer>

<style>
	.footer {
		border-top: 1px solid var(--color-border);
		background-color: var(--color-bg-elevated);
		padding: 1.5rem 1.5rem;
	}

	.footer-inner {
		max-width: 80rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
	}

	@media (min-width: 640px) {
		.footer-inner {
			flex-direction: row;
			justify-content: space-between;
		}
	}

	.footer-copyright {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.copyright-text {
		font-weight: 500;
		color: var(--color-text);
	}

	.copyright-divider {
		color: var(--color-text-muted);
	}

	.copyright-tagline {
		color: var(--color-text-muted);
	}

	.footer-nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.footer-link {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: color 0.15s ease;
		letter-spacing: 0.01em;
	}

	.footer-link:hover {
		color: var(--color-text);
	}

	.footer-link-accent {
		color: var(--color-primary);
	}

	.footer-link-accent:hover {
		color: var(--color-primary-hover);
	}
</style>
