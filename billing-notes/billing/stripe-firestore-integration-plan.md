---
title: stripe-firestore-integration-plan
type: note
permalink: billing/stripe-firestore-integration-plan
---

# Stripe + Firestore Integration Plan

## Goals
- Mirror Stripe subscriptions, invoices, and add-ons into Firestore for feature gating and analytics.
- Support recurring plans (Starter $99/mo, Growth $299/mo) and one-time Event add-on ($999).
- Enable upgrade/downgrade, cancellation, trial management, and billing portal self-service.

## Data Model
- `users/{uid}`: Stripe linkage (customer id, active plan snapshot, entitlements, trial info).
- `users/{uid}/subscriptions/{stripeSubscriptionId}`: canonical subscription document with status, items, billing anchors, cancellation flags, invoice refs, event ids.
- `users/{uid}/subscriptionHistory/{eventId}`: immutable log of status transitions and plan changes.
- `users/{uid}/addons/{addonId}`: one-time $999 purchases (charge/invoice references, fulfillment state, expiry).
- `invoices/{invoiceId}` (optional global collection): denormalized invoices for UI.
- `checkoutSessions/{sessionId}`: temporary records for reconciling checkout.session.completed (with TTL).
- `webhookEvents/{eventId}`: processed webhook log for idempotency/debug.

## Webhook Coverage
Handle `customer.created`, `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end`, `payment_intent.succeeded` (addon).

## Backend Capabilities
- Checkout endpoint: create Stripe Checkout session, store pending record, return URL.
- Billing portal endpoint: start Stripe billing portal session.
- Webhook handler: verify signature, upsert Firestore docs based on event type, maintain entitlements/history.
- Mutation endpoints: plan change (update subscription), cancellation (immediate or period-end), resume, trigger $999 add-on checkout.
- Optional scheduled job for trial-expiring users or stale checkout cleanup.

## Frontend Updates
- Pricing page: fetch plan status, disable purchases when already subscribed, surface trial/usage data.
- My Account: display current plan from Firestore, manage billing via portal link, list invoices/add-ons.
- Dashboard gating: enforce feature limits via entitlements and trial usage counters stored in Firestore.

## Testing & Tooling
- Use Stripe CLI `listen --forward-to http://localhost:5002/api/billing/webhook` in dev.
- Add Playwright flow up to hosted Checkout; manual card entry completes tests.
- Write integration tests hitting webhook emulator to verify Firestore writes.

## Next Steps
1. Implement Firestore admin helpers and types.
2. Expand webhook handler with Firestore persistence and idempotency.
3. Update load functions/UI to consume Firestore data.
4. Build mutation endpoints for cancel/upgrade/add-on.
5. Add monitoring/logging (webhookEvent records, Cloud Logging filters).
