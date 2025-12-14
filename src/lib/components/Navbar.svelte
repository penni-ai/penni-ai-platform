<script lang="ts">
	import Logo from './Logo.svelte';
	import Button from './Button.svelte';

	interface Props {
		firebaseUser?: { email: string | null } | null;
		profile?: {
			full_name?: string | null;
		} | null;
	}

	let {
		firebaseUser = null,
		profile = null
	}: Props = $props();

	let mobileMenuOpen = $state(false);

	const displayName = $derived(() => profile?.full_name ?? firebaseUser?.email ?? 'there');
</script>

<nav class="navbar">
	<div class="navbar-container">
		<div class="navbar-content">
			<!-- Logo -->
			<a href="/" class="logo-link">
				<Logo />
			</a>

			<!-- Navigation Links (Desktop) -->
			<div class="nav-links">
				<a href="/" class="nav-link">Home</a>
			</div>

			<!-- Auth Buttons (Desktop) -->
			<div class="auth-section">
				{#if firebaseUser}
					<div class="user-info">
						<span class="user-name">{displayName()}</span>
					</div>
					<a href="/dashboard" class="nav-link">
						Dashboard
					</a>
					<a href="/logout" data-sveltekit-reload class="btn-outline-dark">
						Sign out
					</a>
				{:else}
					<a href="/sign-up" class="nav-link hidden-mobile">
						Sign up
					</a>
					<Button size="sm" href="/sign-in">Sign in</Button>
				{/if}

				<!-- Mobile Menu Button -->
				<button
					class="mobile-menu-btn"
					onclick={() => mobileMenuOpen = !mobileMenuOpen}
					aria-label="Toggle menu"
				>
					{#if mobileMenuOpen}
						<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="3" y1="12" x2="21" y2="12"></line>
							<line x1="3" y1="6" x2="21" y2="6"></line>
							<line x1="3" y1="18" x2="21" y2="18"></line>
						</svg>
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Mobile Menu -->
	{#if mobileMenuOpen}
		<div class="mobile-menu">
			<a href="/" class="mobile-nav-link" onclick={() => mobileMenuOpen = false}>Home</a>
			{#if firebaseUser}
				<a href="/dashboard" class="mobile-nav-link" onclick={() => mobileMenuOpen = false}>Dashboard</a>
				<a href="/logout" data-sveltekit-reload class="mobile-nav-link" onclick={() => mobileMenuOpen = false}>Sign out</a>
			{:else}
				<a href="/sign-up" class="mobile-nav-link" onclick={() => mobileMenuOpen = false}>Sign up</a>
				<a href="/sign-in" class="mobile-nav-link mobile-nav-link-primary" onclick={() => mobileMenuOpen = false}>Sign in</a>
			{/if}
		</div>
	{/if}
</nav>

<style>
	/* Dark Navbar Base */
	.navbar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 50;
		background: #1a1a1a;
		color: #f5f5f5;
		border-bottom: 1px solid #2a2a2a;
	}

	.navbar-container {
		max-width: 80rem;
		margin: 0 auto;
		padding: 0 1rem;
	}

	@media (min-width: 640px) {
		.navbar-container {
			padding: 0 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.navbar-container {
			padding: 0 2rem;
		}
	}

	.navbar-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 4rem;
	}

	/* Logo */
	.logo-link {
		display: flex;
		align-items: center;
		text-decoration: none;
	}

	/* Navigation Links */
	.nav-links {
		display: none;
		align-items: center;
		gap: 2rem;
	}

	@media (min-width: 768px) {
		.nav-links {
			display: flex;
		}
	}

	.nav-link {
		color: #a3a3a3;
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		transition: color 0.2s ease;
	}

	.nav-link:hover {
		color: #f5f5f5;
	}

	.nav-link.active {
		color: #FF6F61;
	}

	/* Auth Section */
	.auth-section {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.user-info {
		display: none;
		flex-direction: column;
		align-items: flex-end;
		font-size: 0.75rem;
	}

	@media (min-width: 640px) {
		.user-info {
			display: flex;
		}
	}

	.user-name {
		color: #a3a3a3;
		font-weight: 600;
	}

	.hidden-mobile {
		display: none;
	}

	@media (min-width: 640px) {
		.hidden-mobile {
			display: inline-block;
		}
	}

	/* Dark Outline Button */
	.btn-outline-dark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: 9999px;
		border: 2px solid #a3a3a3;
		color: #a3a3a3;
		background: transparent;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.btn-outline-dark:hover {
		border-color: #f5f5f5;
		color: #f5f5f5;
		background: rgba(255, 255, 255, 0.1);
	}

	/* Mobile Menu Button */
	.mobile-menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		border: none;
		color: #a3a3a3;
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.mobile-menu-btn:hover {
		color: #f5f5f5;
	}

	@media (min-width: 768px) {
		.mobile-menu-btn {
			display: none;
		}
	}

	/* Mobile Menu */
	.mobile-menu {
		display: flex;
		flex-direction: column;
		padding: 1rem;
		background: #1a1a1a;
		border-top: 1px solid #2a2a2a;
	}

	@media (min-width: 768px) {
		.mobile-menu {
			display: none;
		}
	}

	.mobile-nav-link {
		display: block;
		padding: 0.75rem 1rem;
		color: #a3a3a3;
		text-decoration: none;
		font-size: 1rem;
		font-weight: 500;
		border-radius: 0.5rem;
		transition: all 0.2s ease;
	}

	.mobile-nav-link:hover {
		color: #f5f5f5;
		background: rgba(255, 255, 255, 0.05);
	}

	.mobile-nav-link-primary {
		color: #FF6F61;
	}

	.mobile-nav-link-primary:hover {
		color: #FF6F61;
		background: rgba(255, 111, 97, 0.1);
	}
</style>
