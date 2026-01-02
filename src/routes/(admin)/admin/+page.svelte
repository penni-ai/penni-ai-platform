<svelte:head>
	<title>Admin Overview - Penny Platform</title>
</svelte:head>

<section class="admin-overview">
	<div class="overview-card">
		<h2>Pipeline Operations</h2>
		<p>Inspect pipeline runs, costs, and stage progress across the platform.</p>
		<a class="overview-link" href="/admin/pipeline-runs">Open pipeline runs</a>
	</div>

	<div class="overview-card">
		<h2>BrightData Cache</h2>
		<p>Browse cached raw profiles and verify cache hit rates.</p>
		<a class="overview-link" href="/admin/cache">Open cache</a>
	</div>

	<div class="overview-card muted">
		<h2>User & Billing</h2>
		<p>User and subscription management will live here once the admin APIs are wired up.</p>
		<span class="overview-soon">Coming soon</span>
	</div>
</section>

<style>
	.admin-overview {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 18px;
	}

	.overview-card {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 16px;
		padding: 20px;
		background: #fff;
	}

	.overview-card h2 {
		margin: 0 0 8px 0;
		font-size: 18px;
		color: #0f172a;
	}

	.overview-card p {
		margin: 0 0 16px 0;
		color: rgba(15, 23, 42, 0.6);
		font-size: 14px;
	}

	.overview-link {
		display: inline-flex;
		align-items: center;
		padding: 8px 14px;
		border-radius: 999px;
		background: #0f172a;
		color: #fff;
		text-decoration: none;
		font-size: 13px;
	}

	.overview-card.muted {
		background: rgba(15, 23, 42, 0.04);
	}

	.overview-soon {
		font-size: 12px;
		color: rgba(15, 23, 42, 0.5);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
</style>
