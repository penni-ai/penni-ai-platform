<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { plans } from '$lib/billing/plans';
	import type { LayoutData } from './$types';

	let { data }: { data: LayoutData } = $props();
	const isLoggedIn = $derived(!!data.firebaseUser);

	let heroSection: HTMLElement;
	let statsSection: HTMLElement;
	let howItWorksSection: HTMLElement;
	let featuresSection: HTMLElement;
	let ctaSection: HTMLElement;
	let svgContainer: SVGSVGElement;

	// Animation state
	let gsapLoaded = $state(false);

	onMount(async () => {
		if (!browser) return;

		// Dynamically import GSAP
		const { gsap } = await import('gsap');
		const { ScrollTrigger } = await import('gsap/ScrollTrigger');
		gsap.registerPlugin(ScrollTrigger);
		gsapLoaded = true;

		// Hero animations
		const heroTimeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
		heroTimeline
			.from('.hero-date', { opacity: 0, y: 20, duration: 0.6 })
			.from('.hero-title', { opacity: 0, y: 40, duration: 0.8 }, '-=0.3')
			.from('.hero-subtitle', { opacity: 0, y: 30, duration: 0.6 }, '-=0.4')
			.from('.hero-cta', { opacity: 0, y: 20, duration: 0.5 }, '-=0.3')
			.from('.hero-visual', { opacity: 0, scale: 0.9, duration: 1 }, '-=0.5');

		// SVG Network Animation - Influencers orbiting around business
		const influencerNodes = document.querySelectorAll('.influencer-node');
		const connectionLines = document.querySelectorAll('.connection-line');

		// Animate influencer nodes floating
		influencerNodes.forEach((node, i) => {
			const delay = i * 0.2;
			const duration = 3 + Math.random() * 2;

			// Initial appearance
			gsap.from(node, {
				opacity: 0,
				scale: 0,
				duration: 0.8,
				delay: 1 + delay,
				ease: 'back.out(1.7)'
			});

			// Continuous floating animation
			gsap.to(node, {
				y: -10 + Math.random() * 20,
				x: -5 + Math.random() * 10,
				duration: duration,
				repeat: -1,
				yoyo: true,
				ease: 'sine.inOut',
				delay: delay
			});
		});

		// Animate connection lines
		connectionLines.forEach((line, i) => {
			gsap.from(line, {
				strokeDashoffset: 200,
				opacity: 0,
				duration: 1.5,
				delay: 1.5 + i * 0.1,
				ease: 'power2.out'
			});

			// Pulse animation on lines
			gsap.to(line, {
				opacity: 0.3,
				duration: 1.5,
				repeat: -1,
				yoyo: true,
				ease: 'sine.inOut',
				delay: i * 0.2
			});
		});

		// Center business node pulse
		const businessNode = document.querySelector('.business-node');
		if (businessNode) {
			gsap.to(businessNode, {
				scale: 1.05,
				duration: 2,
				repeat: -1,
				yoyo: true,
				ease: 'sine.inOut'
			});
		}

		// Stats section scroll animation
		ScrollTrigger.create({
			trigger: statsSection,
			start: 'top 80%',
			onEnter: () => {
				gsap.from('.stat-item', {
					opacity: 0,
					y: 50,
					duration: 0.8,
					stagger: 0.15,
					ease: 'power3.out'
				});

				// Animate numbers counting up
				document.querySelectorAll('.stat-number').forEach((el) => {
					const target = parseInt(el.getAttribute('data-value') || '0');
					gsap.to(el, {
						innerText: target,
						duration: 2,
						snap: { innerText: 1 },
						ease: 'power2.out'
					});
				});
			},
			once: true
		});

		// How it works scroll animation
		// Set initial state
		gsap.set('.step-card', { opacity: 0, x: -60 });
		ScrollTrigger.create({
			trigger: howItWorksSection,
			start: 'top 70%',
			onEnter: () => {
				gsap.to('.step-card', {
					opacity: 1,
					x: 0,
					duration: 0.8,
					stagger: 0.2,
					ease: 'power3.out'
				});
			},
			once: true
		});

		// Brands scroll animation
		// Set initial state
		gsap.set('.brand-card', { opacity: 0, y: 40 });
		gsap.set('.brand-stat', { opacity: 0, y: 30 });
		ScrollTrigger.create({
			trigger: featuresSection,
			start: 'top 70%',
			onEnter: () => {
				gsap.to('.brand-card', {
					opacity: 1,
					y: 0,
					duration: 0.6,
					stagger: 0.08,
					ease: 'power3.out'
				});
				gsap.to('.brand-stat', {
					opacity: 1,
					y: 0,
					duration: 0.6,
					stagger: 0.15,
					delay: 0.4,
					ease: 'power3.out'
				});
			},
			once: true
		});

		// CTA section animation
		gsap.set('.cta-content', { opacity: 0, y: 40 });
		ScrollTrigger.create({
			trigger: ctaSection,
			start: 'top 80%',
			onEnter: () => {
				gsap.to('.cta-content', {
					opacity: 1,
					y: 0,
					duration: 0.8,
					ease: 'power3.out'
				});
			},
			once: true
		});
	});

	const brands = [
		{ name: 'ByteDance', logo: null },
		{ name: 'CASETiFY', logo: null },
		{ name: 'Partiful', logo: null },
		{ name: 'Lulus', logo: null },
		{ name: 'Meitu', logo: null },
		{ name: 'SUNO', logo: null },
		{ name: 'Norma Kamali', logo: null },
		{ name: 'Darry Ring', logo: null }
	];
</script>

<svelte:head>
	<title>Penni AI – Find & Connect with Perfect Influencers</title>
	<meta name="description" content="AI-powered influencer marketing platform. Find perfectly matched creators, send personalized outreach, and grow your brand.">
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
</svelte:head>

<div class="landing">
	<!-- Inline Header -->
	<header class="site-header">
		<a href="/" class="logo">
			<img src="/images/branding/main%20logo%20SVG.svg" alt="Penni" class="logo-img" />
		</a>
		<nav class="header-nav">
			<a href="#how-it-works" class="nav-link">How it works</a>
			<a href="#pricing" class="nav-link">Pricing</a>
			{#if isLoggedIn}
				<a href="/dashboard" class="nav-link nav-link-accent">Dashboard</a>
			{:else}
				<a href="/sign-in" class="nav-link nav-link-accent">Sign in</a>
			{/if}
		</nav>
	</header>

	<!-- Hero Section -->
	<section bind:this={heroSection} class="hero">
		<div class="hero-container">
			<div class="hero-content">
				<span class="hero-date">Influencer Marketing, Reimagined</span>
				<h1 class="hero-title">
					Connect with creators who<br/>
					<span class="hero-title-accent">actually move the needle</span>
				</h1>
				<p class="hero-subtitle">
					Stop scrolling through endless profiles. Our AI finds influencers perfectly matched to your brand,
					then helps you reach out at scale with messages that get responses.
				</p>
				<div class="hero-cta">
					<a href="/sign-up" class="btn-primary">
						Start free trial
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M5 12h14M12 5l7 7-7 7"/>
						</svg>
					</a>
					<a href="#how-it-works" class="btn-secondary">See how it works</a>
				</div>
			</div>

			<!-- Animated Steps Visual - One at a time -->
			<div class="hero-visual">
				<div class="hero-steps-carousel">
					<!-- Step 1: Form typing -->
					<div class="hero-slide hero-slide-1">
						<div class="hero-slide-header">
							<span class="hero-slide-number">1</span>
							<span class="hero-slide-title">Describe your brand</span>
						</div>
						<div class="hero-slide-content">
							<div class="hero-form-demo">
								<div class="hf-field">
									<span class="hf-label">Website</span>
									<div class="hf-input">
										<span class="hf-typing">mybrand.com</span>
										<span class="hf-cursor"></span>
									</div>
								</div>
								<div class="hf-field">
									<span class="hf-label">Looking for</span>
									<div class="hf-input">
										<span class="hf-typing hf-typing-2">Fashion creators</span>
									</div>
								</div>
								<div class="hf-btn">Search</div>
							</div>
						</div>
					</div>

					<!-- Step 2: Profiles appearing -->
					<div class="hero-slide hero-slide-2">
						<div class="hero-slide-header">
							<span class="hero-slide-number">2</span>
							<span class="hero-slide-title">Get matched instantly</span>
						</div>
						<div class="hero-slide-content">
							<div class="hero-profiles-demo">
								<div class="hp-row hp-row-1">
									<div class="hp-avatar" style="background: #a855f7"></div>
									<div class="hp-info"><div class="hp-name"></div><div class="hp-handle"></div></div>
									<div class="hp-followers">12.5K</div>
								</div>
								<div class="hp-row hp-row-2">
									<div class="hp-avatar" style="background: #3b82f6"></div>
									<div class="hp-info"><div class="hp-name"></div><div class="hp-handle"></div></div>
									<div class="hp-followers">8.2K</div>
								</div>
								<div class="hp-row hp-row-3">
									<div class="hp-avatar" style="background: #10b981"></div>
									<div class="hp-info"><div class="hp-name"></div><div class="hp-handle"></div></div>
									<div class="hp-followers">45K</div>
								</div>
							</div>
						</div>
					</div>

					<!-- Step 3: Emails sending -->
					<div class="hero-slide hero-slide-3">
						<div class="hero-slide-header">
							<span class="hero-slide-number">3</span>
							<span class="hero-slide-title">Launch outreach</span>
						</div>
						<div class="hero-slide-content">
							<div class="hero-send-demo">
								<div class="hs-btn">
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
								</div>
								<div class="hs-envelope hs-e1"></div>
								<div class="hs-envelope hs-e2"></div>
								<div class="hs-envelope hs-e3"></div>
								<div class="hs-envelope hs-e4"></div>
								<div class="hs-envelope hs-e5"></div>
								<div class="hs-envelope hs-e6"></div>
								<div class="hs-envelope hs-e7"></div>
								<div class="hs-envelope hs-e8"></div>
								<div class="hs-counter">
									<span class="hs-num hs-n1">1</span>
									<span class="hs-num hs-n2">28</span>
									<span class="hs-num hs-n3">57</span>
									<span class="hs-num hs-n4">86</span>
									<span class="hs-num hs-n5">100</span>
									<span class="hs-label">sent</span>
								</div>
							</div>
						</div>
					</div>

					<!-- Progress dots -->
					<div class="hero-dots">
						<span class="hero-dot hero-dot-1"></span>
						<span class="hero-dot hero-dot-2"></span>
						<span class="hero-dot hero-dot-3"></span>
					</div>
				</div>
			</div>
		</div>

		<!-- Scroll indicator -->
		<div class="scroll-indicator">
			<span>Scroll to explore</span>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 5v14M5 12l7 7 7-7"/>
			</svg>
		</div>
	</section>

	<!-- Stats Section -->
	<section bind:this={statsSection} class="stats-section">
		<div class="stats-container">
			<div class="stat-item">
				<span class="stat-number" data-value="200">0</span>
				<span class="stat-suffix">k+</span>
				<span class="stat-label">Influencers available</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat-item">
				<span class="stat-number" data-value="50">0</span>
				<span class="stat-label">Avg influencers per search</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat-item">
				<span class="stat-number" data-value="3">0</span>
				<span class="stat-suffix">min</span>
				<span class="stat-label">To launch a campaign</span>
			</div>
		</div>
	</section>

	<!-- How It Works Section -->
	<section bind:this={howItWorksSection} id="how-it-works" class="how-it-works-section">
		<div class="section-container">
			<div class="section-header">
				<span class="section-label">Simple Process</span>
				<h2 class="section-title">How it Works</h2>
			</div>

			<div class="steps-grid">
				<!-- Step 1: Describe your brand -->
				<div class="step-card">
					<div class="step-animation">
						<div class="typing-demo">
							<div class="demo-window">
								<div class="demo-header">
									<span class="demo-dot"></span>
									<span class="demo-dot"></span>
									<span class="demo-dot"></span>
								</div>
								<div class="demo-content">
									<div class="demo-field">
										<span class="demo-label">Website</span>
										<div class="demo-input">
											<span class="typing-text">www.mybrand.com</span>
											<span class="typing-cursor"></span>
										</div>
									</div>
									<div class="demo-field">
										<span class="demo-label">Looking for</span>
										<div class="demo-input">
											<span class="typing-text-2">Fashion influencers...</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
					<span class="step-number">01</span>
					<h3 class="step-title">Describe your brand</h3>
					<p class="step-description">Share your website and tell us what kind of influencers you want to reach. Our AI understands your niche instantly.</p>
				</div>

				<!-- Step 2: Get matched instantly -->
				<div class="step-card">
					<div class="step-animation">
						<div class="profiles-demo">
							<div class="profile-row profile-row-1">
								<div class="profile-avatar" style="background: #a855f7;"></div>
								<div class="profile-info">
									<div class="profile-name"></div>
									<div class="profile-handle"></div>
								</div>
								<div class="profile-followers">12.5K</div>
							</div>
							<div class="profile-row profile-row-2">
								<div class="profile-avatar" style="background: #3b82f6;"></div>
								<div class="profile-info">
									<div class="profile-name"></div>
									<div class="profile-handle"></div>
								</div>
								<div class="profile-followers">8.2K</div>
							</div>
							<div class="profile-row profile-row-3">
								<div class="profile-avatar" style="background: #10b981;"></div>
								<div class="profile-info">
									<div class="profile-name"></div>
									<div class="profile-handle"></div>
								</div>
								<div class="profile-followers">45K</div>
							</div>
							<div class="profile-row profile-row-4">
								<div class="profile-avatar" style="background: #f59e0b;"></div>
								<div class="profile-info">
									<div class="profile-name"></div>
									<div class="profile-handle"></div>
								</div>
								<div class="profile-followers">22K</div>
							</div>
						</div>
					</div>
					<span class="step-number">02</span>
					<h3 class="step-title">Get matched instantly</h3>
					<p class="step-description">We scan thousands of creators and deliver a curated list of perfect matches — no bots, no irrelevant profiles.</p>
				</div>

				<!-- Step 3: Launch outreach -->
				<div class="step-card">
					<div class="step-animation">
						<div class="compose-demo">
							<!-- Email composition window -->
							<div class="compose-window">
								<div class="compose-header">
									<span class="compose-dot"></span>
									<span class="compose-dot"></span>
									<span class="compose-dot"></span>
								</div>
								<div class="compose-body">
									<div class="compose-to">
										<span class="compose-label">To:</span>
										<span class="compose-recipient"></span>
									</div>
									<div class="compose-subject">
										<span class="compose-label">Subject:</span>
										<span class="compose-subject-text"></span>
									</div>
									<div class="compose-content">
										<div class="compose-line compose-line-1"></div>
										<div class="compose-line compose-line-2"></div>
										<div class="compose-line compose-line-3"></div>
									</div>
								</div>
							</div>
							<!-- Many envelopes flying in all directions -->
							<div class="envelope-burst">
								<div class="flying-envelope e1"></div>
								<div class="flying-envelope e2"></div>
								<div class="flying-envelope e3"></div>
								<div class="flying-envelope e4"></div>
								<div class="flying-envelope e5"></div>
								<div class="flying-envelope e6"></div>
								<div class="flying-envelope e7"></div>
								<div class="flying-envelope e8"></div>
								<div class="flying-envelope e9"></div>
								<div class="flying-envelope e10"></div>
								<div class="flying-envelope e11"></div>
								<div class="flying-envelope e12"></div>
							</div>
							<!-- Animated counter 1-100 -->
							<div class="send-counter">
								<div class="counter-numbers">
									<span class="num num-1">1</span>
									<span class="num num-2">24</span>
									<span class="num num-3">47</span>
									<span class="num num-4">68</span>
									<span class="num num-5">85</span>
									<span class="num num-6">100</span>
								</div>
								<span class="counter-label">sent</span>
							</div>
						</div>
					</div>
					<span class="step-number">03</span>
					<h3 class="step-title">Launch outreach</h3>
					<p class="step-description">Send personalized emails at scale. Wake up to real interest from creators excited to collaborate with you.</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Brands Section -->
	<section bind:this={featuresSection} class="brands-section">
		<div class="section-container">
			<div class="section-header">
				<span class="section-label">Trusted Partners</span>
				<h2 class="section-title">Brands we've worked with</h2>
				<p class="section-subtitle">From the creators of <a href="https://www.dimeinc-us.com/" target="_blank" rel="noopener noreferrer">DIME</a>, we've helped leading brands connect with thousands of creators</p>
			</div>

			<div class="brands-grid">
				{#each brands as brand}
					<div class="brand-card">
						<span class="brand-name">{brand.name}</span>
					</div>
				{/each}
			</div>

		</div>
	</section>

	<!-- Brands Stats Section -->
	<section class="brands-stats-section">
		<div class="brands-stats">
			<div class="brand-stat">
				<span class="brand-stat-number">50M+</span>
				<span class="brand-stat-label">Impressions generated</span>
			</div>
			<div class="brand-stat">
				<span class="brand-stat-number">10K+</span>
				<span class="brand-stat-label">Creators activated</span>
			</div>
			<div class="brand-stat">
				<span class="brand-stat-number">100+</span>
				<span class="brand-stat-label">Campaigns launched</span>
			</div>
		</div>
	</section>

	<!-- Pricing Section -->
	<section id="pricing" class="pricing-preview-section">
		<div class="section-container">
			<div class="section-header">
				<span class="section-label">Transparent Pricing</span>
				<h2 class="section-title">Plans that scale with you</h2>
			</div>

			<div class="pricing-cards">
				{#each plans.filter(p => p.key !== 'event').slice(0, 3) as plan}
					<div class="pricing-card" class:pricing-card-featured={plan.badge === 'Most popular'}>
						{#if plan.badge}
							<span class="pricing-badge">{plan.badge}</span>
						{/if}
						<h3 class="pricing-name">{plan.name}</h3>
						<div class="pricing-price">
							<span class="pricing-amount">{plan.price}</span>
							<span class="pricing-cadence">/{plan.cadence.split(' ')[0]}</span>
						</div>
						<ul class="pricing-features">
							{#each plan.features.slice(0, 3) as feature}
								<li>{feature}</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>

			<div class="pricing-cta">
				<a href="/sign-up" class="btn-primary">Start free trial</a>
			</div>
		</div>
	</section>

	<!-- Final CTA Section -->
	<section bind:this={ctaSection} class="cta-section">
		<div class="cta-content">
			<h2 class="cta-title">Ready to find your perfect creators?</h2>
			<p class="cta-subtitle">
				Join hundreds of brands using Penni to build authentic influencer partnerships.
				Start your free trial today — no credit card required.
			</p>
			<div class="cta-buttons">
				<a href="/sign-up" class="btn-primary btn-large">
					Start free trial
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M5 12h14M12 5l7 7-7 7"/>
					</svg>
				</a>
			</div>
			<p class="cta-note">3-day trial with 20 influencers and 10 outreach emails</p>
		</div>
	</section>

	<!-- Footer -->
	<footer class="site-footer">
		<div class="footer-container">
			<div class="footer-brand">
				<img src="/images/branding/main%20logo%20SVG.svg" alt="Penni" class="footer-logo" />
				<p class="footer-tagline">AI-powered influencer marketing</p>
				<p class="footer-dime">From the creators of <a href="https://www.dimeinc-us.com/" target="_blank" rel="noopener noreferrer">DIME</a></p>
			</div>
			<div class="footer-links">
				<a href="#how-it-works">How it works</a>
				<a href="#pricing">Pricing</a>
				<a href="/privacy">Privacy</a>
				<a href="/terms">Terms</a>
			</div>
			<p class="footer-copyright">&copy; {new Date().getFullYear()} Penni AI. All rights reserved.</p>
		</div>
	</footer>
</div>

<style>
	:global(html) {
		scroll-behavior: smooth;
	}

	.landing {
		--coral: #FF6F61;
		--coral-dark: #e85d50;
		--ink: #1a1a1a;
		--ink-light: #4a4a4a;
		--ink-muted: #8a8a8a;
		--paper: #fafaf9;
		--paper-warm: #f5f4f2;
		--border: #e8e6e3;

		font-family: 'DM Sans', system-ui, sans-serif;
		color: var(--ink);
		overflow-x: hidden;
	}

	/* Site Header */
	.site-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 100;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 2rem;
		background: rgba(250, 250, 249, 0.8);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.logo {
		display: flex;
		align-items: center;
	}

	.logo-img {
		height: 40px;
		width: auto;
	}

	.header-nav {
		display: flex;
		align-items: center;
		gap: 2rem;
	}

	.nav-link {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--ink-light);
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.nav-link:hover {
		color: var(--ink);
	}

	.nav-link-accent {
		color: var(--coral);
		font-weight: 600;
	}

	.nav-link-accent:hover {
		color: var(--coral-dark);
	}

	/* Hero Section */
	.hero {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: center;
		background: linear-gradient(180deg, var(--paper) 0%, white 50%, var(--paper-warm) 100%);
		position: relative;
		padding: 8rem 2rem 4rem;
	}

	.hero-container {
		max-width: 1400px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4rem;
		align-items: center;
	}

	.hero-content {
		max-width: 600px;
	}

	.hero-date {
		display: inline-block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: var(--coral);
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.hero-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2.5rem, 5vw, 4rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--ink);
		margin-bottom: 1.5rem;
	}

	.hero-title-accent {
		color: var(--coral);
		font-style: italic;
	}

	.hero-subtitle {
		font-size: 1.125rem;
		line-height: 1.7;
		color: var(--ink-light);
		margin-bottom: 2.5rem;
	}

	.hero-cta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.hero-visual {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.network-svg {
		width: 100%;
		max-width: 500px;
		height: auto;
	}

	/* Hero Steps Carousel - One step at a time */
	.hero-steps-carousel {
		position: relative;
		width: 480px;
		height: 360px;
		background: white;
		border-radius: 1.5rem;
		border: 1px solid var(--border);
		box-shadow: 0 16px 50px rgba(0, 0, 0, 0.12);
		overflow: hidden;
	}

	.hero-slide {
		position: absolute;
		inset: 0;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		opacity: 0;
		transform: translateX(30px);
		transition: none;
	}

	/* 9s total: 3s per slide */
	.hero-slide-1 {
		animation: slide-cycle 9s ease-in-out infinite;
	}
	.hero-slide-2 {
		animation: slide-cycle 9s ease-in-out infinite;
		animation-delay: 3s;
	}
	.hero-slide-3 {
		animation: slide-cycle 9s ease-in-out infinite;
		animation-delay: 6s;
	}

	@keyframes slide-cycle {
		0% { opacity: 0; transform: translateX(30px); }
		5% { opacity: 1; transform: translateX(0); }
		30% { opacity: 1; transform: translateX(0); }
		33% { opacity: 0; transform: translateX(-30px); }
		100% { opacity: 0; transform: translateX(-30px); }
	}

	.hero-slide-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.hero-slide-number {
		width: 40px;
		height: 40px;
		background: var(--coral);
		color: white;
		border-radius: 50%;
		font-size: 18px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.hero-slide-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--ink);
	}

	.hero-slide-content {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Step 1: Form Demo */
	.hero-form-demo {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.hf-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.hf-label {
		font-size: 0.8rem;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.hf-input {
		background: var(--paper);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		font-size: 1rem;
		color: var(--ink);
		display: flex;
		align-items: center;
	}

	.hf-typing {
		display: inline-block;
		overflow: hidden;
		white-space: nowrap;
		max-width: 0;
		animation: hf-type 9s steps(12) infinite;
	}

	.hf-typing-2 {
		animation: hf-type-2 9s steps(16) infinite;
	}

	@keyframes hf-type {
		0%, 3% { max-width: 0; }
		15%, 30% { max-width: 100px; }
		33%, 100% { max-width: 100px; }
	}

	@keyframes hf-type-2 {
		0%, 8% { max-width: 0; }
		20%, 30% { max-width: 130px; }
		33%, 100% { max-width: 130px; }
	}

	.hf-cursor {
		display: inline-block;
		width: 2px;
		height: 18px;
		background: var(--coral);
		margin-left: 2px;
		animation: hf-blink 0.6s infinite;
	}

	@keyframes hf-blink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0; }
	}

	.hf-btn {
		align-self: flex-start;
		background: var(--coral);
		color: white;
		padding: 0.65rem 1.5rem;
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 600;
		opacity: 0;
		transform: scale(0.9);
		animation: hf-btn-appear 9s ease-out infinite;
	}

	@keyframes hf-btn-appear {
		0%, 18% { opacity: 0; transform: scale(0.9); }
		25%, 30% { opacity: 1; transform: scale(1); }
		33%, 100% { opacity: 0; transform: scale(1); }
	}

	/* Step 2: Profiles Demo */
	.hero-profiles-demo {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.hp-row {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		background: var(--paper);
		padding: 0.75rem 1rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		opacity: 0;
		transform: translateX(-15px);
	}

	.hp-row-1 { animation: hp-slide 9s ease-out infinite; animation-delay: 3s; }
	.hp-row-2 { animation: hp-slide 9s ease-out infinite; animation-delay: 3.15s; }
	.hp-row-3 { animation: hp-slide 9s ease-out infinite; animation-delay: 3.3s; }

	@keyframes hp-slide {
		0%, 3% { opacity: 0; transform: translateX(-15px); }
		10%, 28% { opacity: 1; transform: translateX(0); }
		33%, 100% { opacity: 0; transform: translateX(0); }
	}

	.hp-avatar {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.hp-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.hp-name {
		height: 12px;
		width: 100px;
		background: var(--ink);
		border-radius: 4px;
		opacity: 0.15;
	}

	.hp-handle {
		height: 10px;
		width: 70px;
		background: var(--ink);
		border-radius: 4px;
		opacity: 0.08;
	}

	.hp-followers {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--coral);
	}

	/* Step 3: Send Demo */
	.hero-send-demo {
		position: relative;
		width: 100%;
		height: 180px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.hs-btn {
		width: 72px;
		height: 72px;
		background: var(--coral);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		z-index: 2;
		animation: hs-pulse 9s ease-in-out infinite;
		animation-delay: 6s;
	}

	.hs-btn svg {
		width: 30px;
		height: 30px;
	}

	@keyframes hs-pulse {
		0%, 5% { transform: scale(1); }
		10% { transform: scale(1.15); }
		15%, 33% { transform: scale(1); }
		100% { transform: scale(1); }
	}

	.hs-envelope {
		position: absolute;
		width: 20px;
		height: 14px;
		background: white;
		border: 2px solid var(--coral);
		border-radius: 3px;
		opacity: 0;
	}

	.hs-envelope::before {
		content: '';
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		border-left: 7px solid transparent;
		border-right: 7px solid transparent;
		border-top: 5px solid var(--coral);
	}

	.hs-e1 { animation: hs-burst-1 9s ease-out infinite; animation-delay: 6s; }
	.hs-e2 { animation: hs-burst-2 9s ease-out infinite; animation-delay: 6.05s; }
	.hs-e3 { animation: hs-burst-3 9s ease-out infinite; animation-delay: 6.1s; }
	.hs-e4 { animation: hs-burst-4 9s ease-out infinite; animation-delay: 6.08s; }
	.hs-e5 { animation: hs-burst-5 9s ease-out infinite; animation-delay: 6.15s; }
	.hs-e6 { animation: hs-burst-6 9s ease-out infinite; animation-delay: 6.03s; }
	.hs-e7 { animation: hs-burst-7 9s ease-out infinite; animation-delay: 6.12s; }
	.hs-e8 { animation: hs-burst-8 9s ease-out infinite; animation-delay: 6.07s; }

	@keyframes hs-burst-1 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(100px,-65px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-2 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(-95px,-60px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-3 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(110px,20px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-4 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(-105px,30px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-5 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(75px,65px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-6 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(-80px,60px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-7 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(15px,-80px) scale(0.5); } 100% { opacity:0; } }
	@keyframes hs-burst-8 { 0%,8% { opacity:0; transform:translate(0,0) scale(0.5); } 12% { opacity:1; transform:scale(1); } 28% { opacity:0; transform:translate(-20px,75px) scale(0.5); } 100% { opacity:0; } }

	.hs-counter {
		position: absolute;
		bottom: 15px;
		right: 15px;
		display: flex;
		align-items: baseline;
		gap: 5px;
		background: var(--paper);
		padding: 0.5rem 0.85rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		opacity: 0;
		animation: hs-counter-show 9s ease-out infinite;
		animation-delay: 6s;
	}

	@keyframes hs-counter-show {
		0%, 12% { opacity: 0; transform: scale(0.9); }
		18%, 28% { opacity: 1; transform: scale(1); }
		33%, 100% { opacity: 0; }
	}

	.hs-num {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--coral);
		position: absolute;
		opacity: 0;
	}

	.hs-n1 { animation: hs-num 9s ease-out infinite; animation-delay: 6.3s; }
	.hs-n2 { animation: hs-num 9s ease-out infinite; animation-delay: 6.5s; }
	.hs-n3 { animation: hs-num 9s ease-out infinite; animation-delay: 6.7s; }
	.hs-n4 { animation: hs-num 9s ease-out infinite; animation-delay: 6.9s; }
	.hs-n5 { animation: hs-num-last 9s ease-out infinite; animation-delay: 7.1s; }

	@keyframes hs-num {
		0% { opacity: 0; }
		2% { opacity: 1; }
		4% { opacity: 0; }
		100% { opacity: 0; }
	}

	@keyframes hs-num-last {
		0% { opacity: 0; }
		2% { opacity: 1; }
		20% { opacity: 1; }
		25% { opacity: 0; }
		100% { opacity: 0; }
	}

	.hs-label {
		font-size: 0.85rem;
		color: var(--ink-muted);
		margin-left: 30px;
	}

	/* Progress dots */
	.hero-dots {
		position: absolute;
		bottom: 1.25rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.6rem;
	}

	.hero-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--border);
		transition: background 0.3s ease;
	}

	.hero-dot-1 { animation: dot-active 9s infinite; }
	.hero-dot-2 { animation: dot-active 9s infinite; animation-delay: 3s; }
	.hero-dot-3 { animation: dot-active 9s infinite; animation-delay: 6s; }

	@keyframes dot-active {
		0%, 5% { background: var(--coral); }
		30%, 33% { background: var(--coral); }
		34%, 100% { background: var(--border); }
	}

	.scroll-indicator {
		position: absolute;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		color: var(--ink-muted);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		animation: bounce 2s infinite;
	}

	@keyframes bounce {
		0%, 100% { transform: translateX(-50%) translateY(0); }
		50% { transform: translateX(-50%) translateY(8px); }
	}

	/* Buttons */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 2rem;
		background: var(--coral);
		color: white;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		border-radius: 3rem;
		transition: all 0.3s ease;
	}

	.btn-primary:hover {
		background: var(--coral-dark);
		transform: translateY(-2px);
		box-shadow: 0 10px 30px -10px rgba(255, 111, 97, 0.5);
	}

	.btn-primary.btn-large {
		padding: 1.25rem 2.5rem;
		font-size: 1.05rem;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 2rem;
		background: transparent;
		color: var(--ink);
		font-size: 0.95rem;
		font-weight: 500;
		text-decoration: none;
		border: 1px solid var(--border);
		border-radius: 3rem;
		transition: all 0.3s ease;
	}

	.btn-secondary:hover {
		border-color: var(--ink);
		background: var(--ink);
		color: white;
	}

	/* Stats Section */
	.stats-section {
		background: var(--ink);
		padding: 5rem 2rem;
	}

	.stats-container {
		max-width: 1000px;
		margin: 0 auto;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 4rem;
	}

	.stat-item {
		text-align: center;
	}

	.stat-number {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 4rem;
		font-weight: 400;
		color: white;
		line-height: 1;
	}

	.stat-suffix {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		color: var(--coral);
		margin-left: 0.25rem;
	}

	.stat-label {
		display: block;
		margin-top: 0.75rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgba(255, 255, 255, 0.6);
	}

	.stat-divider {
		width: 1px;
		height: 60px;
		background: rgba(255, 255, 255, 0.2);
	}

	/* Section Common Styles */
	.section-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 2rem;
	}

	.section-header {
		text-align: center;
		margin-bottom: 4rem;
	}

	.section-label {
		display: inline-block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: var(--coral);
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.section-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2rem, 4vw, 3rem);
		font-weight: 400;
		color: var(--ink);
	}

	/* How It Works Section */
	.how-it-works-section {
		padding: 8rem 2rem;
		background: white;
	}

	.steps-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2rem;
	}

	.step-card {
		padding: 2.5rem;
		background: var(--paper);
		border-radius: 1.5rem;
		border: 1px solid var(--border);
		transition: all 0.3s ease;
	}

	.step-card:hover {
		transform: translateY(-4px);
		box-shadow: 0 20px 40px -20px rgba(0, 0, 0, 0.1);
		border-color: var(--coral);
	}

	.step-number {
		display: inline-block;
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 3rem;
		color: var(--coral);
		line-height: 1;
		margin-bottom: 1.5rem;
	}

	.step-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--ink);
		margin-bottom: 0.75rem;
	}

	.step-description {
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--ink-light);
	}

	/* Step Animations */
	.step-animation {
		height: 140px;
		margin-bottom: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Typing Demo Animation */
	.typing-demo {
		width: 100%;
	}

	.demo-window {
		background: white;
		border-radius: 0.75rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		overflow: hidden;
		border: 1px solid var(--border);
	}

	.demo-header {
		background: var(--paper-warm);
		padding: 0.5rem 0.75rem;
		display: flex;
		gap: 0.35rem;
		border-bottom: 1px solid var(--border);
	}

	.demo-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ddd;
	}

	.demo-dot:nth-child(1) { background: #ff5f56; }
	.demo-dot:nth-child(2) { background: #ffbd2e; }
	.demo-dot:nth-child(3) { background: #27ca3f; }

	.demo-content {
		padding: 0.75rem;
	}

	.demo-field {
		margin-bottom: 0.5rem;
	}

	.demo-field:last-child {
		margin-bottom: 0;
	}

	.demo-label {
		font-size: 0.65rem;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		display: block;
		margin-bottom: 0.25rem;
	}

	.demo-input {
		background: var(--paper);
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		padding: 0.4rem 0.6rem;
		font-size: 0.8rem;
		color: var(--ink);
		display: flex;
		align-items: center;
	}

	.typing-text {
		display: inline-block;
		overflow: hidden;
		white-space: nowrap;
		animation: typing 2s steps(16) infinite;
		max-width: 0;
	}

	.typing-text-2 {
		display: inline-block;
		overflow: hidden;
		white-space: nowrap;
		animation: typing2 2s steps(22) infinite;
		animation-delay: 1s;
		max-width: 0;
	}

	.typing-cursor {
		display: inline-block;
		width: 2px;
		height: 14px;
		background: var(--coral);
		margin-left: 2px;
		animation: blink 0.8s infinite;
	}

	@keyframes typing {
		0%, 10% { max-width: 0; }
		50%, 100% { max-width: 120px; }
	}

	@keyframes typing2 {
		0%, 10% { max-width: 0; }
		60%, 100% { max-width: 150px; }
	}

	@keyframes blink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0; }
	}

	/* Profiles Demo Animation */
	.profiles-demo {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow: hidden;
	}

	.profile-row {
		display: flex;
		align-items: center;
		gap: 8px;
		background: white;
		padding: 6px 10px;
		border-radius: 8px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		border: 1px solid var(--border);
		opacity: 0;
		transform: translateX(-20px);
	}

	.profile-row-1 {
		animation: slide-in-row 3s ease-out infinite;
	}

	.profile-row-2 {
		animation: slide-in-row 3s ease-out infinite;
		animation-delay: 0.2s;
	}

	.profile-row-3 {
		animation: slide-in-row 3s ease-out infinite;
		animation-delay: 0.4s;
	}

	.profile-row-4 {
		animation: slide-in-row 3s ease-out infinite;
		animation-delay: 0.6s;
	}

	@keyframes slide-in-row {
		0% {
			opacity: 0;
			transform: translateX(-20px);
		}
		15% {
			opacity: 1;
			transform: translateX(0);
		}
		85% {
			opacity: 1;
			transform: translateX(0);
		}
		100% {
			opacity: 0;
			transform: translateX(0);
		}
	}

	.profile-avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.profile-info {
		flex: 1;
		min-width: 0;
	}

	.profile-name {
		height: 8px;
		width: 70%;
		background: var(--ink);
		border-radius: 4px;
		opacity: 0.15;
		margin-bottom: 4px;
	}

	.profile-handle {
		height: 6px;
		width: 50%;
		background: var(--ink);
		border-radius: 3px;
		opacity: 0.08;
	}

	.profile-followers {
		font-size: 10px;
		font-weight: 600;
		color: var(--coral);
		flex-shrink: 0;
	}

	/* Compose & Send Email Animation */
	.compose-demo {
		position: relative;
		width: 100%;
		height: 130px;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.compose-window {
		width: 100%;
		background: white;
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		border: 1px solid var(--border);
		overflow: hidden;
		animation: compose-sequence 3s ease-in-out infinite;
	}

	.compose-header {
		background: var(--paper-warm);
		padding: 6px 10px;
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border);
	}

	.compose-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.compose-dot:nth-child(1) { background: #ff5f56; }
	.compose-dot:nth-child(2) { background: #ffbd2e; }
	.compose-dot:nth-child(3) { background: #27ca3f; }

	.compose-body {
		padding: 8px 10px;
	}

	.compose-to,
	.compose-subject {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border);
	}

	.compose-label {
		font-size: 9px;
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.compose-recipient {
		height: 6px;
		width: 80px;
		background: var(--coral);
		border-radius: 3px;
		opacity: 0;
		animation: type-field 3s ease-in-out infinite;
	}

	.compose-subject-text {
		height: 6px;
		width: 100px;
		background: var(--ink);
		border-radius: 3px;
		opacity: 0;
		animation: type-field 3s ease-in-out infinite;
		animation-delay: 0.2s;
	}

	.compose-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 4px;
	}

	.compose-line {
		height: 5px;
		background: var(--ink);
		border-radius: 2px;
		opacity: 0;
	}

	.compose-line-1 {
		width: 90%;
		animation: type-line 3s ease-in-out infinite;
		animation-delay: 0.4s;
	}

	.compose-line-2 {
		width: 75%;
		animation: type-line 3s ease-in-out infinite;
		animation-delay: 0.5s;
	}

	.compose-line-3 {
		width: 60%;
		animation: type-line 3s ease-in-out infinite;
		animation-delay: 0.6s;
	}

	@keyframes type-field {
		0%, 5% { opacity: 0; width: 0; }
		20%, 45% { opacity: 0.2; width: 80px; }
		55%, 100% { opacity: 0; width: 80px; }
	}

	@keyframes type-line {
		0%, 10% { opacity: 0; transform: scaleX(0); transform-origin: left; }
		25%, 45% { opacity: 0.1; transform: scaleX(1); }
		55%, 100% { opacity: 0; transform: scaleX(1); }
	}

	@keyframes compose-sequence {
		0%, 45% {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
		50% {
			opacity: 1;
			transform: scale(0.7) translateY(0);
		}
		55% {
			opacity: 0;
			transform: scale(0.3) translateY(-10px);
		}
		56%, 100% {
			opacity: 0;
			transform: scale(1) translateY(0);
		}
	}

	.envelope-burst {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
	}

	.flying-envelope {
		position: absolute;
		width: 16px;
		height: 12px;
		background: white;
		border: 1.5px solid var(--coral);
		border-radius: 2px;
		opacity: 0;
	}

	.flying-envelope::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 6px;
		border-bottom: 1.5px solid var(--coral);
		background: linear-gradient(135deg, transparent 45%, var(--coral) 45%, var(--coral) 55%, transparent 55%),
		            linear-gradient(225deg, transparent 45%, var(--coral) 45%, var(--coral) 55%, transparent 55%);
	}

	.e1  { animation: burst1  3s ease-out infinite; animation-delay: 0.00s; }
	.e2  { animation: burst2  3s ease-out infinite; animation-delay: 0.05s; }
	.e3  { animation: burst3  3s ease-out infinite; animation-delay: 0.10s; }
	.e4  { animation: burst4  3s ease-out infinite; animation-delay: 0.08s; }
	.e5  { animation: burst5  3s ease-out infinite; animation-delay: 0.15s; }
	.e6  { animation: burst6  3s ease-out infinite; animation-delay: 0.03s; }
	.e7  { animation: burst7  3s ease-out infinite; animation-delay: 0.12s; }
	.e8  { animation: burst8  3s ease-out infinite; animation-delay: 0.07s; }
	.e9  { animation: burst9  3s ease-out infinite; animation-delay: 0.18s; }
	.e10 { animation: burst10 3s ease-out infinite; animation-delay: 0.13s; }
	.e11 { animation: burst11 3s ease-out infinite; animation-delay: 0.20s; }
	.e12 { animation: burst12 3s ease-out infinite; animation-delay: 0.16s; }

	@keyframes burst1  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(75px,-45px) scale(0.4); } }
	@keyframes burst2  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(-70px,-40px) scale(0.4); } }
	@keyframes burst3  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(85px,10px) scale(0.4); } }
	@keyframes burst4  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(-80px,15px) scale(0.4); } }
	@keyframes burst5  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(55px,50px) scale(0.4); } }
	@keyframes burst6  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(-60px,45px) scale(0.4); } }
	@keyframes burst7  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(10px,-60px) scale(0.4); } }
	@keyframes burst8  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(-15px,-55px) scale(0.4); } }
	@keyframes burst9  { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(45px,-55px) scale(0.4); } }
	@keyframes burst10 { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(-50px,-50px) scale(0.4); } }
	@keyframes burst11 { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(70px,35px) scale(0.4); } }
	@keyframes burst12 { 0%,50% { opacity:0; transform:translate(0,0) scale(0.5); } 55% { opacity:1; transform:scale(1); } 100% { opacity:0; transform:translate(-65px,30px) scale(0.4); } }

	.send-counter {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: var(--coral);
		border-radius: 50%;
		opacity: 0;
		animation: counter-pop 3s ease-in-out infinite;
	}

	.counter-numbers {
		position: relative;
		height: 18px;
		overflow: hidden;
	}

	.num {
		position: absolute;
		font-size: 16px;
		font-weight: 700;
		color: white;
		line-height: 1;
		opacity: 0;
		left: 50%;
		transform: translateX(-50%);
	}

	.num-1 { animation: num-cycle 3s ease-out infinite; animation-delay: 0s; }
	.num-2 { animation: num-cycle 3s ease-out infinite; animation-delay: 0.15s; }
	.num-3 { animation: num-cycle 3s ease-out infinite; animation-delay: 0.30s; }
	.num-4 { animation: num-cycle 3s ease-out infinite; animation-delay: 0.45s; }
	.num-5 { animation: num-cycle 3s ease-out infinite; animation-delay: 0.60s; }
	.num-6 { animation: num-cycle-last 3s ease-out infinite; animation-delay: 0.75s; }

	@keyframes num-cycle {
		0%, 48% { opacity: 0; }
		52% { opacity: 1; }
		56% { opacity: 0; }
		100% { opacity: 0; }
	}

	@keyframes num-cycle-last {
		0%, 70% { opacity: 0; }
		75% { opacity: 1; }
		95% { opacity: 1; }
		100% { opacity: 0; }
	}

	.counter-label {
		font-size: 7px;
		color: rgba(255, 255, 255, 0.85);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-top: 1px;
	}

	@keyframes counter-pop {
		0%, 48% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0);
		}
		55% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.15);
		}
		60%, 92% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.9);
		}
	}

	/* Brands Section */
	.brands-section {
		padding: 5rem 2rem;
		background: var(--paper-warm);
	}

	.brands-section .section-header {
		margin-bottom: 2.5rem;
	}

	.section-subtitle {
		font-size: 1rem;
		color: var(--ink-light);
		margin-top: 0.75rem;
		max-width: 500px;
		margin-left: auto;
		margin-right: auto;
	}

	.section-subtitle a {
		color: var(--coral);
		font-weight: 600;
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.section-subtitle a:hover {
		color: var(--coral-dark);
		text-decoration: underline;
	}

	.brands-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.brand-card {
		padding: 1.25rem 1rem;
		background: white;
		border-radius: 0.75rem;
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.3s ease;
	}

	.brand-card:hover {
		transform: translateY(-3px);
		box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.1);
		border-color: var(--coral);
	}

	.brand-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--ink);
		letter-spacing: -0.01em;
	}

	.brands-stats-section {
		background: var(--ink);
		padding: 4rem 2rem;
	}

	.brands-stats {
		max-width: 1000px;
		margin: 0 auto;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 5rem;
	}

	.brand-stat {
		text-align: center;
	}

	.brand-stat-number {
		display: block;
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 3.5rem;
		color: white;
		line-height: 1;
		margin-bottom: 0.5rem;
	}

	.brand-stat-label {
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.6);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	/* Pricing Preview Section */
	.pricing-preview-section {
		padding: 8rem 2rem;
		background: white;
	}

	.pricing-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
		margin-bottom: 3rem;
	}

	.pricing-card {
		position: relative;
		padding: 2.5rem;
		background: var(--paper);
		border-radius: 1.5rem;
		border: 1px solid var(--border);
		transition: all 0.3s ease;
	}

	.pricing-card:hover {
		transform: translateY(-4px);
		box-shadow: 0 20px 40px -20px rgba(0, 0, 0, 0.1);
	}

	.pricing-card-featured {
		background: var(--ink);
		border-color: var(--ink);
	}

	.pricing-card-featured .pricing-name,
	.pricing-card-featured .pricing-amount,
	.pricing-card-featured .pricing-features li {
		color: white;
	}

	.pricing-card-featured .pricing-cadence {
		color: rgba(255, 255, 255, 0.6);
	}

	.pricing-badge {
		position: absolute;
		top: 1.5rem;
		right: 1.5rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.35rem 0.75rem;
		background: var(--coral);
		color: white;
		border-radius: 2rem;
		font-weight: 600;
	}

	.pricing-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
		margin-bottom: 1rem;
	}

	.pricing-price {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
	}

	.pricing-amount {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2.5rem;
		color: var(--ink);
	}

	.pricing-cadence {
		font-size: 0.9rem;
		color: var(--ink-muted);
	}

	.pricing-features {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.pricing-features li {
		font-size: 0.9rem;
		color: var(--ink-light);
		padding: 0.5rem 0;
		border-top: 1px solid var(--border);
	}

	.pricing-card-featured .pricing-features li {
		border-color: rgba(255, 255, 255, 0.1);
	}

	.pricing-cta {
		text-align: center;
	}

	/* CTA Section */
	.cta-section {
		padding: 10rem 2rem;
		background: linear-gradient(180deg, var(--paper-warm) 0%, var(--paper) 100%);
		text-align: center;
	}

	.cta-content {
		max-width: 700px;
		margin: 0 auto;
	}

	.cta-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2rem, 4vw, 3rem);
		font-weight: 400;
		color: var(--ink);
		margin-bottom: 1.5rem;
	}

	.cta-subtitle {
		font-size: 1.125rem;
		line-height: 1.7;
		color: var(--ink-light);
		margin-bottom: 2.5rem;
	}

	.cta-buttons {
		margin-bottom: 1.5rem;
	}

	.cta-note {
		font-size: 0.85rem;
		color: var(--ink-muted);
	}

	/* Footer */
	.site-footer {
		background: var(--ink);
		padding: 4rem 2rem;
	}

	.footer-container {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		text-align: center;
	}

	.footer-brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.footer-logo {
		height: 36px;
		width: auto;
		filter: brightness(0) invert(1);
	}

	.footer-tagline {
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.5);
	}

	.footer-dime {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin-top: 0.25rem;
	}

	.footer-dime a {
		color: rgba(255, 255, 255, 0.6);
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.footer-dime a:hover {
		color: white;
	}

	.footer-links {
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.footer-links a {
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.7);
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.footer-links a:hover {
		color: white;
	}

	.footer-copyright {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.4);
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.hero-container {
			grid-template-columns: 1fr;
			text-align: center;
		}

		.hero-content {
			max-width: 100%;
		}

		.hero-cta {
			justify-content: center;
		}

		.hero-visual {
			order: -1;
		}

		.network-svg {
			max-width: 400px;
		}

		.hero-steps-carousel {
			width: 400px;
			height: 320px;
		}

		.hero-slide {
			padding: 1.5rem;
		}

		.hero-slide-number {
			width: 34px;
			height: 34px;
			font-size: 16px;
		}

		.hero-slide-title {
			font-size: 1.1rem;
		}

		.stats-container {
			flex-wrap: wrap;
			gap: 2rem;
		}

		.stat-divider {
			display: none;
		}

		.steps-grid,
		.pricing-cards {
			grid-template-columns: 1fr;
		}

		.brands-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1rem;
		}

		.brands-stats {
			gap: 3rem;
		}

		.brand-stat-number {
			font-size: 2.5rem;
		}
	}

	@media (max-width: 640px) {
		.site-header {
			padding: 0.75rem 1.25rem;
		}

		.header-nav {
			gap: 1rem;
		}

		.nav-link:not(.nav-link-accent) {
			display: none;
		}

		.logo-img {
			height: 32px;
		}

		.hero {
			padding: 6rem 1.25rem 3rem;
		}

		.hero-title {
			font-size: 2rem;
		}

		.btn-primary, .btn-secondary {
			width: 100%;
			justify-content: center;
		}

		.stat-number {
			font-size: 3rem;
		}

		.section-container {
			padding: 0 1.25rem;
		}

		.scroll-indicator {
			display: none;
		}

		.hero-steps-carousel {
			width: 100%;
			max-width: 360px;
			height: 300px;
		}

		.hero-slide {
			padding: 1.25rem;
		}

		.hero-slide-number {
			width: 32px;
			height: 32px;
			font-size: 14px;
		}

		.hero-slide-title {
			font-size: 1rem;
		}

		.hero-slide-header {
			margin-bottom: 1rem;
		}

		.hs-btn {
			width: 56px;
			height: 56px;
		}

		.hs-btn svg {
			width: 24px;
			height: 24px;
		}

		.brands-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.75rem;
		}

		.brand-card {
			padding: 1.25rem 1rem;
		}

		.brand-name {
			font-size: 0.9rem;
		}

		.brands-stats-section {
			padding: 3rem 1.5rem;
		}

		.brands-stats {
			flex-wrap: wrap;
			gap: 2rem 3rem;
		}

		.brand-stat-number {
			font-size: 2.25rem;
		}

		.footer-links {
			gap: 1.5rem;
		}
	}
</style>
