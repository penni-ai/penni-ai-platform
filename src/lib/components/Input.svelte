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
</script>

<div class="input-wrapper">
	{#if label}
		<label for={inputId} class="input-label" class:has-error={error}>
			{label}
			{#if required}
				<span class="required-mark">*</span>
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
			class="input-field textarea-field {className}"
			class:has-error={error}
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
			class="input-field {className}"
			class:has-error={error}
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
			class="input-field {className}"
			class:has-error={error}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error || helperText ? `${inputId}-description` : undefined}
		/>
	{/if}

	{#if error}
		<p id="{inputId}-description" class="helper-text error-text">
			{error}
		</p>
	{:else if helperText}
		<p id="{inputId}-description" class="helper-text">
			{helperText}
		</p>
	{/if}
</div>

<style>
	.input-wrapper {
		width: 100%;
	}

	.input-label {
		display: block;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.8125rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.input-label.has-error {
		color: var(--color-error);
	}

	.required-mark {
		color: var(--color-primary);
		margin-left: 0.125rem;
	}

	.input-field {
		width: 100%;
		padding: 0.625rem 0.75rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text);
		background-color: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 2px;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.input-field::placeholder {
		color: var(--color-text-muted);
	}

	.input-field:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 1px var(--color-primary);
	}

	.input-field:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background-color: var(--color-bg-subtle);
	}

	.input-field.has-error {
		border-color: var(--color-error);
	}

	.input-field.has-error:focus {
		border-color: var(--color-error);
		box-shadow: 0 0 0 1px var(--color-error);
	}

	.textarea-field {
		resize: vertical;
		min-height: 5rem;
	}

	.helper-text {
		margin-top: 0.375rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.error-text {
		color: var(--color-error);
	}

	/* Dark mode fine-tuning */
	:global([data-theme='dark']) .input-field:focus {
		box-shadow: 0 0 0 1px var(--color-primary);
	}
</style>
