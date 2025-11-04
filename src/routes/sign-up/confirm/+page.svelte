<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import Button from '$lib/components/Button.svelte';

	let { data } = $props();
	const email = (data.email ?? '') as string;
	let resendMessage = $state<string | null>(null);
	let resendError = $state<string | null>(null);
	let isResending = $state(false);

	async function resendConfirmation() {
		if (!email) {
			resendError = 'Email address missing from request.';
			return;
		}

		resendError = null;
		resendMessage = null;
		isResending = true;
		try {
			const response = await fetch('/api/auth/send-verification', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.error ?? 'Unable to send verification email.');
			}
			const info = payload?.link ? `Email sent. Emulator preview link: ${payload.link}` : 'Email sent. Please check your inbox.';
			resendMessage = info;
		} catch (error) {
			resendError =
				error instanceof Error ? error.message : 'Unable to resend verification email. Try again in a moment.';
		} finally {
			isResending = false;
		}
	}
</script>

<div class="min-h-screen bg-gray-50">
	<div class="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-12 text-center space-y-8">
		<Logo size="md" />
		<h1 class="text-3xl font-semibold text-gray-900">Confirm your email</h1>
		<p class="text-sm text-gray-600">
			{#if email}
				We sent a confirmation email to {email}. Please click the link inside to activate your account.
			{:else}
				We sent a confirmation email. Please locate the verification message in your inbox and click the link inside to activate your account.
			{/if}
		</p>

		<div class="w-full max-w-sm">
			<div class="h-2 w-full overflow-hidden rounded-full bg-gray-200">
				<div class="h-full w-1/2 animate-pulse bg-[#FF6F61]"></div>
			</div>
			<p class="mt-3 text-xs text-gray-500">
				Keep this tab open while you verify. Once you’re confirmed, return to sign in.
			</p>
		</div>

		{#if resendMessage}
			<div class="w-full max-w-sm rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
				{resendMessage}
			</div>
		{/if}
		{#if resendError}
			<div class="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
				{resendError}
			</div>
		{/if}

		<div class="flex flex-col gap-4 sm:flex-row">
			<Button variant="outline" href="/sign-in" class="justify-center">I've verified, sign me in</Button>
			<Button type="button" class="justify-center" onclick={resendConfirmation} disabled={isResending}>
				{isResending ? 'Sending…' : 'Resend email'}
			</Button>
		</div>

		<p class="text-xs text-gray-500">
			Didn’t receive anything? Check your spam folder or add support@penny.ai to your contacts, then resend.
		</p>
	</div>
</div>
