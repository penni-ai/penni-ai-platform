---
title: 2025-11-05_frontend_subscriptions_and_logo
type: note
permalink: progress/2025-11-05-frontend-subscriptions-and-logo
---

- Implemented in-app plan change flow that previews upgrades/downgrades and avoids Stripe Checkout redirects. Added fallback messaging when upcoming invoice previews are unavailable from the emulator.
- Billing UI now shows upgrade vs downgrade messaging, and downgrades are scheduled for the next cycle with no immediate charge. Confirmation modal updated accordingly.
- Account billing card falls back to the trial end date when the renewal date is missing so “Next invoice” is still populated during trials.
- Updated the reusable logo component to render the uploaded PNG from static/images/branding.
- Reverted email verification links to the original handleCodeInApp=false behavior per user request.
- Tests run: bun run check.