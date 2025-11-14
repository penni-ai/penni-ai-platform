import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

const LOCATION = 'global';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'PROJECT_ID';

const client = new AnthropicVertex({
	region: LOCATION,
	projectId: PROJECT_ID
});

async function main() {
	try {
		const message = await client.messages.create({
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: 'Send me a recipe for banana bread.'
				}
			],
			model: 'claude-haiku-4-5@20251001'
		});

		console.log(JSON.stringify(message, null, 2));
	} catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
}

main();

