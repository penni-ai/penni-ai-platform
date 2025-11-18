import { onRequest } from 'firebase-functions/v2/https';
import { generateSearchQueriesFromDescription } from '../../utils/search-query-generator.js';

/**
 * HTTP Cloud Function to generate multiple search queries from a business description
 */
export const generateSearchQueries = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '512MiB',
    invoker: 'private',
  },
  async (request, response) => {
    try {
      const description =
        (request.body?.description as string) ||
        (request.query.description as string) ||
        'restaurant in san francisco looking for local influencers';

      if (!description || description.trim().length === 0) {
        response.status(400).json({
          status: 'error',
          message: 'Description is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      console.log(`Generating search queries for: "${description}"`);
      const { queries, rawResponse } = await generateSearchQueriesFromDescription(description);

      response.status(200).json({
        status: 'success',
        description,
        count: queries.length,
        queries,
        raw_response: rawResponse,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Query generation error:', error);
      response.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }
);
