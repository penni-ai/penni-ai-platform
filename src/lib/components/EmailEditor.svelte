<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	
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
					}
				})
			],
			content: content || '<p></p>',
			editorProps: {
				attributes: {
					class: 'prose prose-sm max-w-none focus:outline-none min-h-full',
					'data-placeholder': 'Write your email template here... Use {{variable}} for personalization'
				}
			},
			onUpdate: ({ editor }) => {
				const html = editor.getHTML();
				onUpdate?.(html);
			},
			onTransaction: () => {
				// Force reactivity for active states
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

<div class="flex flex-col h-full">
	<!-- Toolbar -->
	{#if editor}
		<div class="border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
			<!-- Text Formatting -->
			<div class="flex items-center gap-1 border-r border-gray-200 pr-2">
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleBold().run()}
					class="p-2 rounded hover:bg-gray-100 {editor?.isActive('bold') ? 'bg-gray-200' : ''}"
					title="Bold"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
					</svg>
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleItalic().run()}
					class="p-2 rounded hover:bg-gray-100 {editor?.isActive('italic') ? 'bg-gray-200' : ''}"
					title="Italic"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
					</svg>
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleBulletList().run()}
					class="p-2 rounded hover:bg-gray-100 {editor?.isActive('bulletList') ? 'bg-gray-200' : ''}"
					title="Bullet List"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
					</svg>
				</button>
			</div>
			
			<!-- Headings -->
			<div class="flex items-center gap-1 border-r border-gray-200 pr-2">
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
					class="px-2 py-1 text-sm rounded hover:bg-gray-100 {editor?.isActive('heading', { level: 1 }) ? 'bg-gray-200 font-semibold' : ''}"
					title="Heading 1"
				>
					H1
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
					class="px-2 py-1 text-sm rounded hover:bg-gray-100 {editor?.isActive('heading', { level: 2 }) ? 'bg-gray-200 font-semibold' : ''}"
					title="Heading 2"
				>
					H2
				</button>
				<button
					type="button"
					onclick={() => editor?.chain().focus().setParagraph().run()}
					class="px-2 py-1 text-sm rounded hover:bg-gray-100 {editor?.isActive('paragraph') ? 'bg-gray-200 font-semibold' : ''}"
					title="Paragraph"
				>
					P
				</button>
			</div>
			
			<!-- Insert Variables -->
			<div class="flex items-center gap-1">
				<span class="text-xs text-gray-500 px-2">Variables:</span>
				<button
					type="button"
					onclick={() => insertVariable('name')}
					class="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100 text-gray-700"
				>
					{'{{name}}'}
				</button>
				<button
					type="button"
					onclick={() => insertVariable('platform')}
					class="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100 text-gray-700"
				>
					{'{{platform}}'}
				</button>
				<button
					type="button"
					onclick={() => insertVariable('email')}
					class="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100 text-gray-700"
				>
					{'{{email}}'}
				</button>
			</div>
		</div>
	{/if}
	
	<!-- Editor Content -->
	<div class="flex-1 overflow-y-auto">
		<div 
			bind:this={editorElement}
			class="prose prose-sm max-w-none p-6 focus:outline-none min-h-full"
		></div>
	</div>
</div>

<style>
	:global(.ProseMirror) {
		outline: none;
		min-height: 100%;
	}
	
	:global(.ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		color: #9ca3af;
		pointer-events: none;
		height: 0;
	}
	
	:global(.ProseMirror h1) {
		font-size: 2em;
		font-weight: bold;
		margin-top: 0.67em;
		margin-bottom: 0.67em;
	}
	
	:global(.ProseMirror h2) {
		font-size: 1.5em;
		font-weight: bold;
		margin-top: 0.83em;
		margin-bottom: 0.83em;
	}
	
	:global(.ProseMirror h3) {
		font-size: 1.17em;
		font-weight: bold;
		margin-top: 1em;
		margin-bottom: 1em;
	}
	
	:global(.ProseMirror ul),
	:global(.ProseMirror ol) {
		padding-left: 1.5em;
		margin: 1em 0;
	}
	
	:global(.ProseMirror li) {
		margin: 0.5em 0;
	}
	
	:global(.ProseMirror strong) {
		font-weight: 600;
	}
	
	:global(.ProseMirror em) {
		font-style: italic;
	}
</style>

