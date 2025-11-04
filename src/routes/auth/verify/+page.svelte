<script lang="ts">
	import { onMount } from 'svelte';
	import { applyActionCode } from 'firebase/auth';
	import { firebaseAuth } from '$lib/firebase/client';
	import { goto } from '$app/navigation';

	let status = $state<'pending' | 'success' | 'error'>('pending');
	let message = $state('Verifying your email…');

	onMount(async () => {
		try {
			const params = new URLSearchParams(window.location.search);
			const mode = params.get('mode');
			const oobCode = params.get('oobCode');

			if (mode !== 'verifyEmail' || !oobCode) {
				throw new Error('Verification link is invalid or expired.');
			}

			await applyActionCode(firebaseAuth, oobCode);
			status = 'success';
			message = 'Email verified! You can sign in now.';
			setTimeout(() => {
				goto('/sign-in?verified=1');
			}, 1500);
		} catch (error) {
			status = 'error';
			message =
				error instanceof Error ? error.message : 'We could not verify your email. Please request a new link.';
		}
	});
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6">
	<div class="w-full max-w-md rounded-3xl bg-white p-10 text-center shadow-xl">
		<h1 class="text-2xl font-semibold text-gray-900">Email verification</h1>
		<p
			class={`mt-4 text-sm ${
				status === 'success'
					? 'text-emerald-600'
					: status === 'error'
						? 'text-red-600'
						: 'text-gray-600'
			}`}
		>
			{message}
		</p>
		{#if status === 'error'}
			<a
				href="/sign-up/confirm"
				class="mt-6 inline-flex items-center justify-center rounded-full bg-[#FF6F61] px-6 py-3 text-sm font-medium text-white hover:bg-[#ff846f]"
			>
				Request another link
			</a>
		{/if}
	</div>
</div>
