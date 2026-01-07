# GCP Evidence Commands (SOC 2 + CASA)

Use these commands to export repeatable evidence for auditors/reviewers. Save outputs (or screenshots) alongside your audit artifacts.

Set:

```bash
export PROJECT_ID="penni-ai-platform"
export REGION="us-central1"
```

## Identity / access (IAM)

```bash
gcloud projects describe "$PROJECT_ID" --format="json(projectId,projectNumber,name,lifecycleState)"
gcloud iam service-accounts list --format="table(email,displayName,disabled)"
gcloud projects get-iam-policy "$PROJECT_ID" --format="json(auditConfigs)"
gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' --format='table(bindings.role,bindings.members)'
```

Service account keys (verify none are user-managed):

```bash
gcloud iam service-accounts keys list --iam-account="firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com" --managed-by=user
gcloud iam service-accounts keys list --iam-account="pipeline-service@${PROJECT_ID}.iam.gserviceaccount.com" --managed-by=user
```

## Cloud Run (services + invokers)

```bash
gcloud run services list --region="$REGION" --format='table(metadata.name,status.url,spec.template.spec.serviceAccountName)'
gcloud run services describe "penni-ai-platform-backend" --region="$REGION" --format='json(status.url,spec.template.spec.serviceAccountName,metadata.annotations."run.googleapis.com/ingress")'
gcloud run services describe "pipeline-service" --region="$REGION" --format='json(status.url,spec.template.spec.serviceAccountName,metadata.annotations."run.googleapis.com/ingress")'
gcloud run services get-iam-policy "pipeline-service" --region="$REGION" --format='json(bindings)'
```

Verify secret/env var wiring (names only; values are not printed):

```bash
gcloud run services describe "pipeline-service" --region="$REGION" --format='value(spec.template.spec.containers[0].env[].name)' | sort
```

## Cloud Scheduler + Cloud Tasks

```bash
gcloud scheduler jobs list --location="$REGION" --format='table(name,state,schedule,httpTarget.uri,httpTarget.oidcToken.serviceAccountEmail)'
gcloud tasks queues list --location="$REGION" --format='table(name,state,rateLimits.maxDispatchesPerSecond,rateLimits.maxConcurrentDispatches,retryConfig.maxAttempts)'
```

## Monitoring (alerting)

List notification channels and alert policies (include screenshots/exports for evidence):

```bash
gcloud alpha monitoring channels list --format='table(name,type,displayName)'
gcloud alpha monitoring policies list --format='table(name,displayName,enabled)'
```

## Log-based metrics (alert triggers)

```bash
gcloud logging metrics list --format='table(name)'
gcloud logging metrics describe iam_policy_changes --format=json
gcloud logging metrics describe scheduler_pipeline_service_health_failures --format=json
gcloud logging metrics describe scheduler_email_queue_processor_failures --format=json
```

## Secrets (Secret Manager)

List secrets and review IAM per secret (avoid project-wide access when possible):

```bash
gcloud secrets list --format='table(name,replication.automatic,labels)'
gcloud secrets describe "GMAIL_TOKEN_ENCRYPTION_KEY" --format='json(name,replication,labels,rotation)'
gcloud secrets get-iam-policy "GMAIL_TOKEN_ENCRYPTION_KEY" --format='json(bindings)'
gcloud secrets get-iam-policy "STRIPE_SECRET_KEY" --format='json(bindings)'
```

## Logging posture / retention

```bash
gcloud logging buckets describe _Default --location=global --format='json(retentionDays,locked,createTime,updateTime)'
gcloud logging buckets describe _Required --location=global --format='json(retentionDays,locked,createTime,updateTime)'
gcloud logging sinks list --format='table(name,destination,filter)'
```

## Artifact Registry (image storage + vulnerability scanning)

```bash
gcloud services list --enabled --filter='config.name:artifactregistry.googleapis.com OR config.name:containerscanning.googleapis.com OR config.name:containeranalysis.googleapis.com OR config.name:ondemandscanning.googleapis.com' --format='table(config.name)'
gcloud artifacts repositories list --location="$REGION" --format='table(name,format,mode)'
gcloud artifacts repositories describe firebaseapphosting-images --location="$REGION" --format='json(name,registryUri,vulnerabilityScanningConfig)'
gcloud artifacts repositories describe pipeline-service-images --location="$REGION" --format='json(name,registryUri,vulnerabilityScanningConfig)'
```

## Firestore (backups)

```bash
gcloud firestore databases list --format='table(name,type,locationId,keyRingName)'
gcloud firestore backups schedules list --database='(default)' --format='table(name,state,retention,backupLocation)'
gcloud firestore backups list --format='table(name,database,state,createTime,expireTime)' --limit=20
```

## Cloud Storage (Firebase Storage bucket)

```bash
gcloud storage buckets describe "gs://${PROJECT_ID}.firebasestorage.app" --format='json(name,location,uniform_bucket_level_access,public_access_prevention,soft_delete_policy,update_time)'
gcloud storage buckets get-iam-policy "gs://${PROJECT_ID}.firebasestorage.app" --format=json
```

## Network hygiene (firewall)

If you are not using Compute Engine, remove or lock down default “open” firewall rules:

```bash
gcloud compute instances list --format='table(name,zone,status)'
gcloud compute firewall-rules list --format=json | python -c 'import json,sys; rules=json.load(sys.stdin); open=[];\nfor r in rules:\n  if r.get(\"direction\")==\"INGRESS\" and not r.get(\"disabled\") and (\"0.0.0.0/0\" in (r.get(\"sourceRanges\") or []) or \"::/0\" in (r.get(\"sourceRanges\") or [])):\n    open.append(r)\nprint(\"open_ingress_rules:\", len(open));\nfor r in sorted(open, key=lambda x:x.get(\"name\",\"\")):\n  allowed=r.get(\"allowed\") or [];\n  allow_str=\",\".join([a.get(\"IPProtocol\",\"\")+\"/\"+\";\".join(a.get(\"ports\") or []) for a in allowed]);\n  print(r.get(\"name\"), allow_str, r.get(\"sourceRanges\"))'
```
