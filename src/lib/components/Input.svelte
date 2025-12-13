<script lang="ts">
interface Props {
	type?: 'text' | 'email' | 'password' | 'number' | 'url' | 'tel' | 'search' | 'textarea';
	value?: string | number | null;
	placeholder?: string;
	disabled?: boolean;
	rows?: number;
	class?: string;
	id?: string;
	name?: string;
	required?: boolean;
	min?: number;
	max?: number;
	step?: number;
	error?: string;
	label?: string;
	helperText?: string;
}

let {
	type = 'text',
	value = $bindable(''),
	placeholder = '',
	disabled = false,
	rows = 3,
	class: className = '',
	id,
	name,
	required = false,
	min,
	max,
	step,
	error,
	label,
	helperText
}: Props = $props();

const inputId = $derived(id || name || `input-${Math.random().toString(36).substring(7)}`);

const baseStyles =
	'w-full font-body transition-all duration-200 border focus:outline-none focus:ring-2 focus:ring-offset-0';

const sizeStyles = type === 'textarea' ? 'px-3 py-2.5 text-sm' : 'px-3 py-2 text-sm';

const stateStyles = $derived(
	error
		? 'border-error focus:border-error focus:ring-error/20'
		: 'border-default focus:border-primary focus:ring-primary/20'
);

const classes = $derived(
	[baseStyles, sizeStyles, stateStyles, disabled ? 'opacity-50 cursor-not-allowed' : '', className]
		.filter(Boolean)
		.join(' ')
);
</script>

{#if label}
	<label for={inputId} class="block text-sm font-medium mb-1.5" class:text-error={error}>
		{label}
		{#if required}
			<span class="text-error">*</span>
		{/if}
	</label>
{/if}

{#if type === 'textarea'}
	<textarea
		bind:value
		{placeholder}
		{disabled}
		{rows}
		id={inputId}
		{name}
		{required}
		class="input-themed {classes}"
		style="min-height: {rows * 1.5}rem;"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error || helperText ? `${inputId}-description` : undefined}
	></textarea>
{:else if type === 'number'}
	<input
		type="number"
		bind:value
		{placeholder}
		{disabled}
		id={inputId}
		{name}
		{required}
		{min}
		{max}
		{step}
		class="input-themed {classes}"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error || helperText ? `${inputId}-description` : undefined}
	/>
{:else}
	<input
		{type}
		bind:value
		{placeholder}
		{disabled}
		id={inputId}
		{name}
		{required}
		class="input-themed {classes}"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error || helperText ? `${inputId}-description` : undefined}
	/>
{/if}

{#if error}
	<p id="{inputId}-description" class="mt-1.5 text-sm text-error">
		{error}
	</p>
{:else if helperText}
	<p id="{inputId}-description" class="mt-1.5 text-sm text-muted">
		{helperText}
	</p>
{/if}

<style>
	.input-themed {
		border-radius: var(--radius-md);
		color: var(--color-text);
		background-color: var(--color-bg-elevated);
	}

	.input-themed::placeholder {
		color: var(--color-text-muted);
	}

	.input-themed:disabled {
		background-color: var(--color-bg-subtle);
	}

	textarea.input-themed {
		resize: vertical;
		min-height: 80px;
	}

	label {
		color: var(--color-text);
	}

	.text-error {
		color: var(--color-error);
	}

	.border-error {
		border-color: var(--color-error);
	}

	.border-default {
		border-color: var(--color-border);
	}

	.focus\:border-primary:focus {
		border-color: var(--color-primary);
	}

	.focus\:border-error:focus {
		border-color: var(--color-error);
	}

	.focus\:ring-primary\/20:focus {
		box-shadow: 0 0 0 3px rgba(255, 111, 97, 0.2);
	}

	[data-theme='dark'] .focus\:ring-primary\/20:focus {
		box-shadow: 0 0 0 3px rgba(255, 133, 119, 0.2);
	}

	.focus\:ring-error\/20:focus {
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
	}

	[data-theme='dark'] .focus\:ring-error\/20:focus {
		box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.2);
	}
</style>
