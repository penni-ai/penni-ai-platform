<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import Button from '$lib/components/Button.svelte';

	type Plan = {
		name: string;
		price: string;
		description: string;
		badge?: string;
		features: string[];
		cta: string;
		destination: string;
		oneTime?: boolean;
	};

	const plans: Plan[] = [
		{
			name: 'Starter Plan',
			price: '$99/mo',
			description: 'Launch intimate events or local promos with a focused guest list.',
			badge: 'Great for local activations',
			features: [
				'Access to 300 new influencer profiles every month',
				'1 connected outreach inbox',
				'Send up to 200 outreach emails per month',
				'Basic campaign analytics dashboard'
			],
			cta: 'Start free trial',
			destination: '/sign-up'
		},
		{
			name: 'Growth Plan',
			price: '$299/mo',
			description: 'Handle multiple launches with deeper reach and reporting.',
			badge: 'Most popular',
			features: [
				'Access to 1,000 new influencer profiles each month',
				'Connect up to 3 outreach inboxes',
				'Send 700 outreach emails per month',
				'Advanced analytics with performance insights & RSVP tracking'
			],
			cta: 'Upgrade now',
			destination: '/sign-up'
		},
		{
			name: 'Event / Pop-Up Special',
			price: '$999 one-time',
			description: 'A concierge blast when you need a venue packed with influencers.',
			features: [
				'One-time import of 5,000 curated influencer profiles',
				'Up to 5 connected inboxes for parallel outreach',
				'Full CSV export plus CRM sync included',
				'Concierge onboarding and done-for-you campaign setup'
			],
			cta: 'Talk with sales',
			destination: 'mailto:hello@penny.ai',
			oneTime: true
		}
	];
</script>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white border-b border-gray-200">
		<div class="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
			<a href="/" class="flex items-center gap-3 text-gray-700 hover:text-gray-900 transition" aria-label="Back to home">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
			</a>
			<Logo size="md" />
			<div class="w-5"></div>
		</div>
	</header>

	<main class="max-w-7xl mx-auto px-6 py-16 space-y-12">
		<section class="text-center space-y-4 max-w-3xl mx-auto">
			<h1 class="text-4xl sm:text-5xl font-bold">Plans built for every launch</h1>
			<p class="text-lg text-gray-600">
				Whether you're testing a local pop-up or filling a 1,500-person launch, choose the plan that matches your outreach volume and reporting needs.
			</p>
			<div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
				All plans include a 3-day trial with 20 curated influencers and 10 outreach emails. Cancel any time.
			</div>
		</section>

		<section class="grid gap-6 md:grid-cols-3">
			{#each plans as plan}
				<article class={`relative flex h-full flex-col rounded-3xl border-2 p-8 bg-white ${plan.badge ? 'border-[#FF6F61]' : 'border-gray-200'}`}>
					{#if plan.badge}
						<div class="absolute -top-3 left-1/2 -translate-x-1/2">
							<span class="inline-flex items-center rounded-full bg-gray-900 px-4 py-1 text-xs font-medium text-white">
								{plan.badge}
							</span>
						</div>
					{/if}
					<header class="mb-6 space-y-2">
						<h2 class="text-2xl font-bold text-gray-900">{plan.name}</h2>
						<p class="text-3xl font-semibold text-gray-900">{plan.price}</p>
						<p class="text-sm text-gray-500">{plan.description}</p>
					</header>

					<ul class="space-y-3 text-sm text-gray-700 flex-1">
						{#each plan.features as feature}
							<li class="flex items-start gap-2">
								<svg class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="currentColor" viewBox="0 0 20 20">
									<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-10.95a1 1 0 010 1.414l-4.243 4.243a1 1 0 01-1.414 0L6.464 12.95a1 1 0 011.414-1.414l1.414 1.414 3.536-3.536a1 1 0 011.414 0z" clip-rule="evenodd" />
								</svg>
								<span>{feature}</span>
							</li>
						{/each}
					</ul>

					<Button class="w-full justify-center mt-8" href={plan.destination} variant={plan.oneTime ? 'outline' : 'primary'}>
						{plan.cta}
					</Button>
				</article>
			{/each}
		</section>

		<section class="rounded-3xl border border-gray-200 bg-white px-8 py-10 space-y-6">
			<h2 class="text-2xl font-semibold text-gray-900 text-center">Need help choosing?</h2>
			<p class="max-w-3xl mx-auto text-center text-gray-600">
				Grab time with our team to walk through the dashboard, map out recommended campaigns, and get a personalised creator list before you commit.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<Button href="mailto:hello@penny.ai">Book a strategy call</Button>
				<Button variant="outline" href="/dashboard">Preview the product UI</Button>
			</div>
		</section>
	</main>
</div>
