import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { openaiClient, DEFAULT_MODEL } from '$lib/server/openai';

interface WebsitePrefillResponse {
	brand?: string;
	website?: string;
	about?: string;
	influencerType?: string;
}

/**
 * Fetch and analyze a website to extract brand information
 */
async function analyzeWebsite(websiteUrl: string): Promise<WebsitePrefillResponse> {
	// Fetch website HTML
	let htmlContent = '';
	try {
		const response = await fetch(websiteUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; PennyBot/1.0; +https://getpenny.com)'
			},
			signal: AbortSignal.timeout(10000) // 10 second timeout
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch website: ${response.status} ${response.statusText}`);
		}

		htmlContent = await response.text();

		// Limit HTML size to avoid token limits (take first 50k chars)
		if (htmlContent.length > 50000) {
			htmlContent = htmlContent.substring(0, 50000);
		}
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'WEBSITE_FETCH_FAILED',
			message: 'Failed to fetch website content. Please ensure the URL is correct and the website is accessible.',
			cause: error
		});
	}

	// Use ChatGPT to analyze the website content
	try {
		const completion = await openaiClient.chat.completions.create({
			model: DEFAULT_MODEL,
			messages: [
				{
					role: 'system',
					content: `You are a brand analysis assistant. Analyze the provided website HTML and extract key brand information.

Your task:
1. Identify the brand name
2. Extract the website URL
3. Summarize what the brand does (their mission, products, or services) in 2-3 sentences
4. Infer what type of influencers/creators would be a good fit for this brand (e.g., "beauty influencers", "fitness creators", "tech reviewers", "lifestyle bloggers", etc.)

Return ONLY valid JSON in this exact format (no additional text):
{
  "brand": "Brand Name",
  "website": "https://example.com",
  "about": "Brief description of what the brand does...",
  "influencerType": "Type of influencers that would fit this brand"
}

If you cannot determine a field, use an empty string "".`
				},
				{
					role: 'user',
					content: `Website URL: ${websiteUrl}\n\nWebsite HTML:\n${htmlContent}`
				}
			],
			temperature: 0.3,
			max_tokens: 500
		});

		const responseText = completion.choices[0]?.message?.content?.trim();
		if (!responseText) {
			throw new Error('Empty response from OpenAI');
		}

		// Parse JSON response
		const parsed = JSON.parse(responseText) as WebsitePrefillResponse;

		// Validate response structure
		if (typeof parsed !== 'object') {
			throw new Error('Invalid response format');
		}

		return {
			brand: typeof parsed.brand === 'string' ? parsed.brand : '',
			website: typeof parsed.website === 'string' ? parsed.website : websiteUrl,
			about: typeof parsed.about === 'string' ? parsed.about : '',
			influencerType: typeof parsed.influencerType === 'string' ? parsed.influencerType : ''
		};
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'WEBSITE_ANALYSIS_FAILED',
			message: 'Failed to analyze website content. Please try again or fill in the form manually.',
			cause: error
		});
	}
}

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({
		component: 'campaigns',
		action: 'prefill_from_website'
	});

	let body: unknown;
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			cause: error
		});
	}

	if (!body || typeof body !== 'object') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PAYLOAD',
			message: 'Request body must be an object.',
			hint: 'Send a JSON payload with a "websiteUrl" field.'
		});
	}

	const payload = body as Record<string, unknown>;
	const websiteUrl = typeof payload.websiteUrl === 'string' ? payload.websiteUrl.trim() : '';

	if (!websiteUrl) {
		throw new ApiProblem({
			status: 400,
			code: 'WEBSITE_URL_REQUIRED',
			message: 'websiteUrl is required.'
		});
	}

	// Validate URL format
	try {
		new URL(websiteUrl);
	} catch {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_URL',
			message: 'websiteUrl must be a valid URL.'
		});
	}

	logger.info('Analyzing website', { websiteUrl, userId: user.uid });

	try {
		const brandInfo = await analyzeWebsite(websiteUrl);
		logger.info('Website analysis complete', { websiteUrl, userId: user.uid, brandInfo });
		return apiOk(brandInfo);
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Unexpected error during website analysis', { error, websiteUrl, userId: user.uid });
		throw new ApiProblem({
			status: 500,
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred while analyzing the website.',
			cause: error
		});
	}
}, { component: 'campaigns' });
