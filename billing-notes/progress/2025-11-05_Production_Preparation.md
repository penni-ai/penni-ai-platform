---
title: 2025-11-05_Production_Preparation
type: note
permalink: progress/2025-11-05-production-preparation
---

- Switched Stripe server helper to runtime configuration (lazy init) to avoid build-time env issues; updated billing routes and webhook handler to use getStripeClient().
- Updated Firebase client to use dynamic env for emulator host; cleaned up pricing/account UI to show next invoice date and upgrade modal details.
- Added billing endpoints (checkout, portal, upgrade, webhook) and Firestore integration; implemented Stripe→Firestore subscription/add-on persistence.
- Replaced logo component to use uploaded PNG; ensured PUBLIC env vars are available via apphosting config.
- Removed apphosting YAMLs from repository (now gitignored) and committed/pushed production-ready changes to GitHub repo.
- Verified Firebase Auth sign-up flow (enabled email/password, allowlisted domain); plan for custom verification emails via Nodemailer + Google Workspace.