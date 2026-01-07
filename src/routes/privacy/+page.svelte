<script lang="ts">
	const lastUpdated = 'December 4, 2024';
</script>

<svelte:head>
	<title>Privacy Policy - Penny</title>
	<meta name="description" content="Privacy Policy for Penny - Learn how we collect, use, and protect your information." />
</svelte:head>

<div class="privacy-page">
	<!-- Hero Header -->
	<header class="page-header">
		<span class="page-label">Legal</span>
		<h1 class="page-title">Privacy Policy</h1>
		<p class="page-date">Last updated: {lastUpdated}</p>
	</header>

	<hr class="header-rule" />

	<!-- Content -->
	<main class="content">
		<section class="legal-section">
			<h2>Introduction</h2>
			<p>
				Welcome to Penny ("we," "our," or "us"). We respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, disclose, and safeguard your information when you use our influencer outreach platform and services.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Information We Collect</h2>

			<h3>Personal Information</h3>
			<p>
				We collect information that you provide directly to us, including:
			</p>
			<ul>
				<li>Account information (name, email address; authentication handled by Firebase Authentication)</li>
				<li>Profile information (company name, website, brand details)</li>
				<li>Billing information (payment method details, billing address)</li>
				<li>Campaign information (campaign details, target audience preferences)</li>
				<li>Communication data (emails, messages, support requests)</li>
			</ul>

			<h3>Connected Account Information</h3>
			<p>
				When you connect third-party accounts (such as Gmail), we collect:
			</p>
			<ul>
				<li>Email address and account identifiers</li>
				<li>OAuth tokens for authorized access</li>
				<li>Email draft and sending permissions</li>
			</ul>

			<h3>Google API Data Use (Gmail)</h3>
			<p>
				If you connect a Gmail account, we use Google APIs to help you draft and send outreach emails you create in Penny.
				We do not request Google API scopes to read your inbox or view existing email messages.
			</p>
			<ul>
				<li>We store Gmail authorization tokens to keep your account connected; refresh tokens are stored encrypted.</li>
				<li>We use Gmail only to create drafts and/or send messages you initiate.</li>
				<li>You can disconnect Gmail at any time, which revokes access and stops queued sends.</li>
			</ul>
			<p>
				Penny’s use and transfer to any other app of information received from Google APIs will adhere to the
				Google API Services User Data Policy, including the Limited Use requirements:
				<a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">https://developers.google.com/terms/api-services-user-data-policy</a>
			</p>

			<h3>Usage Information</h3>
			<p>
				We automatically collect certain information about your device and how you interact with our services:
			</p>
			<ul>
				<li>Log data (IP address, browser type, pages visited, time stamps)</li>
				<li>Device information (device type, operating system)</li>
				<li>Usage patterns (features used, campaign performance metrics)</li>
				<li>Cookies and similar tracking technologies</li>
			</ul>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>How We Use Your Information</h2>
			<p>We use the information we collect to:</p>
			<ul>
				<li>Provide, maintain, and improve our services</li>
				<li>Process your transactions and manage your subscriptions</li>
				<li>Send you technical notices, updates, and support messages</li>
				<li>Respond to your comments, questions, and customer service requests</li>
				<li>Communicate with you about products, services, and promotional offers</li>
				<li>Monitor and analyze trends, usage, and activities</li>
				<li>Detect, prevent, and address technical issues and fraudulent activity</li>
				<li>Personalize and improve your experience with our platform</li>
				<li>Facilitate influencer discovery and outreach campaigns</li>
			</ul>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Information Sharing and Disclosure</h2>
			<p>
				We do not sell your personal information. We may share your information in the following circumstances:
			</p>
			<ul>
				<li><strong>Service Providers:</strong> With third-party vendors who perform services on our behalf (payment processing, email delivery, analytics)</li>
				<li><strong>Business Transfers:</strong> In connection with any merger, sale of company assets, or acquisition</li>
				<li><strong>Legal Requirements:</strong> When required by law or to protect our rights, property, or safety</li>
				<li><strong>With Your Consent:</strong> When you explicitly authorize us to share your information</li>
			</ul>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Data Security</h2>
			<p>
				We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. This includes:
			</p>
			<ul>
				<li>Encryption of data in transit and at rest</li>
				<li>Regular security assessments and updates</li>
				<li>Access controls and authentication measures</li>
				<li>Secure payment processing through trusted providers (Stripe)</li>
			</ul>
			<p>
				However, no method of transmission over the internet or electronic storage is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Data Retention</h2>
			<p>
				We retain your personal information for as long as necessary to fulfill the purposes outlined in this privacy policy, unless a longer retention period is required or permitted by law. When we no longer need your information, we will securely delete or anonymize it.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Your Rights and Choices</h2>
			<p>Depending on your location, you may have certain rights regarding your personal information:</p>
			<ul>
				<li><strong>Access:</strong> Request access to the personal information we hold about you</li>
				<li><strong>Correction:</strong> Request correction of inaccurate or incomplete information</li>
				<li><strong>Deletion:</strong> Request deletion of your personal information</li>
				<li><strong>Data Portability:</strong> Request a copy of your data in a portable format</li>
				<li><strong>Opt-out:</strong> Unsubscribe from marketing communications</li>
				<li><strong>Restriction:</strong> Request restriction of processing in certain circumstances</li>
			</ul>
			<p>
				To exercise these rights, contact us at <a href="mailto:admin@penni-ai.com">admin@penni-ai.com</a> or submit a deletion request from your Account Settings.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Cookies and Tracking Technologies</h2>
			<p>
				We use cookies and similar tracking technologies to collect and track information about your activity on our services. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent. However, some features of our services may not function properly without cookies.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Third-Party Services</h2>
			<p>
				Our services may contain links to third-party websites or integrate with third-party services (such as Gmail, Stripe). We are not responsible for the privacy practices of these third parties. We encourage you to review their privacy policies.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Children's Privacy</h2>
			<p>
				Our services are not intended for children under the age of 18. We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>International Data Transfers</h2>
			<p>
				Your information may be transferred to and processed in countries other than your country of residence. We take appropriate safeguards to ensure that your personal information remains protected in accordance with this privacy policy.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Changes to This Privacy Policy</h2>
			<p>
				We may update this privacy policy from time to time. We will notify you of any material changes by posting the new privacy policy on this page and updating the "Last updated" date. You are advised to review this privacy policy periodically for any changes.
			</p>
		</section>

		<hr class="section-rule" />

		<section class="legal-section">
			<h2>Contact Us</h2>
			<p>
				If you have any questions, concerns, or requests regarding this privacy policy or our privacy practices, please contact us:
			</p>
			<div class="contact-info">
				<span class="contact-label">Email</span>
				<a href="mailto:admin@penni-ai.com" class="contact-link">admin@penni-ai.com</a>
			</div>
		</section>
	</main>

	<!-- Footer Note -->
	<footer class="page-footer">
		<hr class="footer-rule" />
		<p class="footer-note">
			By using Penny, you agree to this Privacy Policy. For more information, see our
			<a href="/terms">Terms of Service</a>.
		</p>
	</footer>
</div>

<style>
	.privacy-page {
		--coral: #FF6F61;
		--coral-dark: #e85d50;
		--ink: #1a1a1a;
		--ink-light: #4a4a4a;
		--ink-muted: #8a8a8a;
		--paper: #fafaf9;
		--border: #e8e6e3;

		font-family: 'DM Sans', system-ui, sans-serif;
		min-height: 100vh;
		background: var(--paper);
		color: var(--ink);
		padding-top: 5rem;
	}

	/* Header */
	.page-header {
		max-width: 720px;
		margin: 0 auto;
		padding: 4rem 2rem 2rem;
		text-align: center;
	}

	.page-label {
		display: inline-block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--coral);
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.page-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(3rem, 7vw, 4.5rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--ink);
		margin-bottom: 1rem;
	}

	.page-date {
		font-size: 1rem;
		color: var(--ink-muted);
	}

	.header-rule {
		max-width: 720px;
		margin: 0 auto 3rem;
		border: none;
		height: 1px;
		background: var(--border);
	}

	/* Content */
	.content {
		max-width: 720px;
		margin: 0 auto;
		padding: 0 2rem;
	}

	.legal-section {
		padding: 2rem 0;
	}

	.legal-section h2 {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.75rem;
		font-weight: 400;
		color: var(--ink);
		margin-bottom: 1.25rem;
		line-height: 1.2;
	}

	.legal-section h3 {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--ink);
		margin-top: 1.75rem;
		margin-bottom: 1rem;
		line-height: 1.3;
	}

	.legal-section h3:first-of-type {
		margin-top: 0;
	}

	.legal-section p {
		font-size: 1.0625rem;
		line-height: 1.75;
		color: var(--ink-light);
		margin-bottom: 1rem;
	}

	.legal-section p:last-child {
		margin-bottom: 0;
	}

	.legal-section ul {
		margin: 1rem 0;
		padding-left: 0;
		list-style: none;
	}

	.legal-section li {
		font-size: 1.0625rem;
		line-height: 1.75;
		color: var(--ink-light);
		margin-bottom: 0.5rem;
		padding-left: 1.5rem;
		position: relative;
	}

	.legal-section li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.75rem;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--coral);
	}

	.legal-section li strong {
		color: var(--ink);
		font-weight: 500;
	}

	.legal-section a {
		color: var(--coral);
		text-decoration: none;
		transition: opacity 0.2s ease;
	}

	.legal-section a:hover {
		opacity: 0.8;
		text-decoration: underline;
	}

	.section-rule {
		border: none;
		height: 1px;
		background: var(--border);
		margin: 0;
	}

	/* Contact */
	.contact-info {
		margin-top: 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.contact-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--ink-muted);
		font-weight: 500;
	}

	.contact-link {
		font-size: 1rem;
		color: var(--coral);
		text-decoration: none;
		font-weight: 500;
		transition: opacity 0.2s ease;
	}

	.contact-link:hover {
		opacity: 0.8;
	}

	/* Footer */
	.page-footer {
		max-width: 720px;
		margin: 0 auto;
		padding: 3rem 2rem 4rem;
	}

	.footer-rule {
		border: none;
		height: 1px;
		background: var(--border);
		margin-bottom: 2rem;
	}

	.footer-note {
		font-size: 0.9rem;
		color: var(--ink-muted);
		text-align: center;
	}

	.footer-note a {
		color: var(--coral);
		text-decoration: none;
		font-weight: 500;
	}

	.footer-note a:hover {
		text-decoration: underline;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.privacy-page {
			padding-top: 4rem;
		}

		.page-header {
			padding: 2rem 1.5rem 1.5rem;
		}

		.page-title {
			font-size: 2.5rem;
		}

		.header-rule {
			margin: 0 1.5rem 2rem;
			max-width: calc(100% - 3rem);
		}

		.content {
			padding: 0 1.5rem;
		}

		.legal-section {
			padding: 1.5rem 0;
		}

		.legal-section h2 {
			font-size: 1.5rem;
		}

		.page-footer {
			padding: 2rem 1.5rem 3rem;
		}

		.contact-info {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}
	}
</style>
