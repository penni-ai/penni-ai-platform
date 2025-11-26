# Penny Platform

A platform for influencer search and analysis.

## Cloud Run Pipeline Migration

The influencer search pipeline is being migrated from Cloud Functions to Cloud Run for better performance and cost efficiency. The migration uses a feature flag to enable gradual rollout, allowing for safe testing and monitoring before fully switching over.

### Configuration

Two environment variables control the migration:

- **`USE_CLOUD_RUN_PIPELINE`**: Feature flag to enable Cloud Run pipeline service (set to `'true'` to use Cloud Run, `'false'` to use Cloud Functions)
- **`CLOUD_RUN_PIPELINE_SERVICE_URL`**: Cloud Run pipeline service URL (required when `USE_CLOUD_RUN_PIPELINE=true`)

To get the Cloud Run service URL after deployment, run:

```bash
gcloud run services describe pipeline-service --region=us-central1 --format='value(status.url)'
```

### Local Development

To test with Cloud Run locally:

1. Set `USE_CLOUD_RUN_PIPELINE=true` in your `.env` file
2. Set `CLOUD_RUN_PIPELINE_SERVICE_URL` to your deployed Cloud Run service URL
3. Ensure the Cloud Run service is deployed and accessible
4. Authentication uses the same service account mechanism as Cloud Functions

### Production Deployment

To enable in App Hosting:

1. Set the environment variables in the Firebase console under App Hosting settings
2. Set `USE_CLOUD_RUN_PIPELINE=true` to enable Cloud Run routing
3. Set `CLOUD_RUN_PIPELINE_SERVICE_URL` to your deployed Cloud Run service URL

**Recommendation**: Test with a small percentage of users first, then gradually increase. Monitor Cloud Run logs and compare metrics with Cloud Functions to ensure performance and reliability.

### Rollback

To rollback to Cloud Functions:

1. Set `USE_CLOUD_RUN_PIPELINE=false` in your environment variables
2. The system will automatically route requests back to Cloud Functions
3. Cloud Functions remain available as a fallback during the migration period

