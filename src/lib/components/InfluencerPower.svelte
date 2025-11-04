<script lang="ts">
	import Badge from './Badge.svelte';
</script>

<section class="py-20 px-4 sm:px-6 lg:px-8 bg-white">
	<div class="max-w-7xl mx-auto">
		<!-- Section Header -->
		<div class="text-center mb-16">
			<Badge variant="blue">INFLUENCER POWER</Badge>
			<h2 class="text-4xl sm:text-5xl font-bold mt-6 mb-4">Why you NEED influencers</h2>
			<p class="text-xl text-gray-600">The Tools You Need To Scale. Nothing Extra.</p>
		</div>

		<!-- Comparison Images -->
		<div class="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
			<!-- Before -->
			<div class="relative rounded-3xl overflow-hidden shadow-xl bg-gradient-to-br from-gray-100 to-gray-200 h-[400px] flex items-center justify-center">
				<div class="absolute top-6 left-6 bg-white rounded-xl p-4 shadow-lg">
					<div class="text-sm font-medium text-gray-500 mb-2">Campaign</div>
					<div class="flex items-center gap-3">
						<div class="flex gap-1">
							{#each Array(8) as _, i}
								<div class="w-4 rounded" style={`height:${Math.random() * 60 + 20}px;background-color:${i % 2 ? '#f87171' : '#fb7185'}; width: 0.75rem;`}></div>
							{/each}
						</div>
						<span class="text-red-500 font-bold text-xl">-120%</span>
					</div>
				</div>
			</div>

			<!-- After -->
			<div class="relative rounded-3xl overflow-hidden shadow-xl bg-gradient-to-br from-pink-100 via-yellow-100 to-white h-[400px] flex items-center justify-center">
				<div class="absolute bottom-6 right-6 bg-white rounded-xl p-4 shadow-lg">
					<div class="flex items-center gap-4 mb-2">
						<div class="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center">
							<span class="text-2xl">📷</span>
						</div>
						<div class="w-10 h-10 rounded-full bg-black flex items-center justify-center">
							<span class="text-white text-xl">▶</span>
						</div>
						<div class="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center">
							<span class="text-white text-xl">▶</span>
						</div>
					</div>
					<div class="flex items-center gap-6 mt-3">
						<div>
							<div class="text-2xl font-bold">120K+</div>
							<div class="text-sm text-gray-500">Reach</div>
						</div>
						<div>
							<div class="text-2xl font-bold">5.4%</div>
							<div class="text-sm text-gray-500">Engagement</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Bottom Text -->
		<div class="text-center mt-16 max-w-3xl mx-auto space-y-4">
			<h3 class="text-3xl font-bold">What sets one restaurant apart from another?</h3>
			<p class="text-lg text-gray-600">It's Not The Food. One Has Influencers And The Other Doesn't.</p>
			<p class="text-xl font-medium text-gray-800">
				The hottest spots today are the ones everyone is talking about on TikTok, Instagram, YouTube, and Xiaohongshu.
			</p>
		</div>
	</div>
</section>
