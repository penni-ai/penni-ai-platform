<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Paragraph from '@tiptap/extension-paragraph';

	interface Props {
		content?: string;
		onUpdate?: (content: string) => void;
	}

	let { content = '', onUpdate }: Props = $props();

	let editorElement = $state<HTMLDivElement | null>(null);
	let editor = $state<Editor | null>(null);

	// Watch for content changes and update editor
	$effect(() => {
		if (editor && content !== undefined) {
			const currentContent = editor.getHTML();
			if (currentContent !== content) {
				editor.commands.setContent(content || '<p></p>', { emitUpdate: false });
			}
		}
	});

	onMount(() => {
		if (!editorElement) return;

		editor = new Editor({
			element: editorElement,
			extensions: [
				StarterKit.configure({
					heading: {
						levels: [1, 2, 3]
					},
					paragraph: false
				}),
				Paragraph.extend({
					parseHTML() {
						return [{ tag: 'p' }];
					},
					renderHTML({ HTMLAttributes }) {
						return ['p', { style: 'margin: 0 0 1em 0;', ...HTMLAttributes }, 0];
					}
				})
			],
			content: content || '<p></p>',
			editorProps: {
				attributes: {
					class: 'prose prose-sm max-w-none focus:outline-none min-h-full',
					'data-placeholder': 'Write your message here... Use {{influencer_name}} for personalization'
				}
			},
			onUpdate: ({ editor }) => {
				const html = editor.getHTML();
				onUpdate?.(html);
			},
			onTransaction: () => {
				editor = editor;
			}
		});

		return () => {
			if (editor) {
				editor.destroy();
			}
		};
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
	});

	function insertVariable(variable: string) {
		if (!editor) return;
		editor.chain().focus().insertContent(`{{${variable}}}`).run();
	}
</script>

<div class="email-editor">
	<!-- Toolbar -->
	{#if editor}
		<div class="toolbar">
			<!-- Text Formatting -->
			<div class="toolbar-group">
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleBold().run()}
					class="toolbar-btn"
					class:active={editor?.isActive('bold')}
					title="Bold"
				>
					<svg class="toolbar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
					</svg>
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleItalic().run()}
					class="toolbar-btn"
					class:active={editor?.isActive('italic')}
					title="Italic"
				>
					<svg class="toolbar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
					</svg>
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleBulletList().run()}
					class="toolbar-btn"
					class:active={editor?.isActive('bulletList')}
					title="Bullet List"
				>
					<svg class="toolbar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
					</svg>
				</button>
			</div>

			<div class="toolbar-divider"></div>

			<!-- Headings -->
			<div class="toolbar-group">
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
					class="toolbar-btn text-btn"
					class:active={editor?.isActive('heading', { level: 1 })}
					title="Heading 1"
				>
					H1
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
					class="toolbar-btn text-btn"
					class:active={editor?.isActive('heading', { level: 2 })}
					title="Heading 2"
				>
					H2
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().setParagraph().run()}
					class="toolbar-btn text-btn"
					class:active={editor?.isActive('paragraph')}
					title="Paragraph"
				>
					P
				</button>
			</div>

			<div class="toolbar-divider"></div>

			<!-- Insert Variables -->
			<div class="toolbar-group variables-group">
				<span class="variables-label">Variables</span>
				<button
					type="button"
					onclick={() => insertVariable('influencer_name')}
					class="variable-btn"
				>
					{'{{influencer_name}}'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Editor Content -->
	<div class="editor-content">
		<div
			bind:this={editorElement}
			class="editor-inner"
		></div>
	</div>
</div>

<style>
	.email-editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: var(--color-bg-elevated);
		border-radius: 2px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-bg-subtle);
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.toolbar-divider {
		width: 1px;
		height: 1.25rem;
		background-color: var(--color-border);
		margin: 0 0.25rem;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		border-radius: 2px;
		transition: all 0.15s ease;
	}

	.toolbar-btn:hover {
		background-color: var(--color-bg-elevated);
		color: var(--color-text);
	}

	.toolbar-btn.active {
		background-color: var(--color-primary);
		color: var(--color-text-inverse);
	}

	.toolbar-btn.text-btn {
		padding: 0.25rem 0.5rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.toolbar-icon {
		width: 1rem;
		height: 1rem;
	}

	.variables-group {
		margin-left: auto;
	}

	.variables-label {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-right: 0.5rem;
	}

	.variable-btn {
		padding: 0.25rem 0.5rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-primary);
		background-color: transparent;
		border: 1px solid var(--color-primary);
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.15s ease;
		letter-spacing: -0.01em;
	}

	.variable-btn:hover {
		background-color: var(--color-primary);
		color: var(--color-text-inverse);
	}

	.editor-content {
		flex: 1;
		overflow-y: auto;
	}

	.editor-inner {
		padding: 1.5rem;
		min-height: 100%;
	}

	/* ProseMirror Editor Styles */
	:global(.ProseMirror) {
		outline: none;
		min-height: 100%;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.9375rem;
		line-height: 1.7;
		color: var(--color-text);
	}

	:global(.ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		color: var(--color-text-muted);
		pointer-events: none;
		height: 0;
		font-style: italic;
	}

	:global(.ProseMirror h1) {
		font-family: var(--font-display, 'Instrument Serif', Georgia, serif);
		font-size: 1.75rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		margin-top: 0.67em;
		margin-bottom: 0.5em;
		color: var(--color-text);
	}

	:global(.ProseMirror h2) {
		font-family: var(--font-display, 'Instrument Serif', Georgia, serif);
		font-size: 1.375rem;
		font-weight: 400;
		letter-spacing: -0.01em;
		margin-top: 0.83em;
		margin-bottom: 0.5em;
		color: var(--color-text);
	}

	:global(.ProseMirror h3) {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin-top: 1em;
		margin-bottom: 0.5em;
		color: var(--color-text);
	}

	:global(.ProseMirror ul),
	:global(.ProseMirror ol) {
		padding-left: 1.5em;
		margin: 1em 0;
	}

	:global(.ProseMirror li) {
		margin: 0.375em 0;
	}

	:global(.ProseMirror strong) {
		font-weight: 600;
	}

	:global(.ProseMirror em) {
		font-style: italic;
	}

	:global(.ProseMirror p) {
		margin: 0 0 1em 0;
		line-height: 1.7;
	}

	:global(.ProseMirror p:last-child) {
		margin-bottom: 0;
	}

	:global(.ProseMirror br.email-hard-break) {
		display: block;
		margin: 0.5em 0;
		content: '';
	}

	/* Selection styling */
	:global(.ProseMirror ::selection) {
		background-color: rgba(255, 111, 97, 0.2);
	}

	/* Dark mode adjustments */
	:global([data-theme="dark"]) .toolbar {
		background-color: var(--color-bg-subtle);
	}

	:global([data-theme="dark"]) .toolbar-btn:hover {
		background-color: var(--color-bg-elevated);
	}
</style>
