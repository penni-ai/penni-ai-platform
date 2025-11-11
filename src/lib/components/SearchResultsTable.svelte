<script lang="ts">
  import { browser } from '$app/environment';
  import type { CreatorProfile } from '$lib/types/search';

  let {
    profiles = [],
    exportFilename = 'search-results.csv'
  }: { profiles: CreatorProfile[]; exportFilename?: string } = $props();

  const formatFollowers = (count: number | null | undefined) => {
    if (!count) return '—';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toLocaleString();
  };

  const getField = (profile: CreatorProfile, key: keyof CreatorProfile) => {
    const value = profile[key];
    return typeof value === 'string' ? value : undefined;
  };

  const getHandle = (profile: CreatorProfile) =>
    profile.username ?? profile.account ?? (profile.name as string | undefined) ?? '—';

  const getFitScore = (profile: CreatorProfile) =>
    profile.fit_score == null ? '—' : `${Math.round(profile.fit_score)}`;
  const serialize = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    if (/[",\n]/.test(str)) {
      return `"${str}"`;
    }
    return str;
  };

  function exportCsv() {
    if (!browser || !profiles.length) return;
    const header = ['username', 'profile_url', 'bio', 'followers', 'fit_score'];
    const rows = profiles.map((profile) => [
      getHandle(profile),
      (profile.profile_url as string) ?? '',
      getField(profile, 'biography') ?? getField(profile, 'bio') ?? '',
      profile.followers ?? '',
      profile.fit_score ?? ''
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((value) => serialize(value)).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename || 'search-results.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
</script>

<div class="overflow-x-auto rounded-3xl border border-gray-200 bg-white shadow-sm">
  <div class="flex items-center justify-between gap-3 px-6 pt-5">
    <p class="text-xs uppercase tracking-wide text-gray-500">Tabular View</p>
    {#if profiles.length}
      <button
        type="button"
        class="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        onclick={exportCsv}
      >
        Export CSV
      </button>
    {/if}
  </div>
  <table class="mt-2 min-w-full divide-y divide-gray-200 text-sm">
    <thead class="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
      <tr>
        <th scope="col" class="px-6 py-3">Username</th>
        <th scope="col" class="px-6 py-3">Profile URL</th>
        <th scope="col" class="px-6 py-3">Bio</th>
        <th scope="col" class="px-6 py-3">Followers</th>
        <th scope="col" class="px-6 py-3">Fit Score</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-100 bg-white text-gray-700">
      {#if profiles.length === 0}
        <tr>
          <td colspan={5} class="px-6 py-8 text-center text-sm text-gray-500">
            No creator results yet. Run a search to populate this table.
          </td>
        </tr>
      {:else}
        {#each profiles as profile}
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 font-medium text-gray-900">{getHandle(profile)}</td>
            <td class="px-6 py-4">
              {#if profile.profile_url}
                <a
                  href={profile.profile_url as string}
                  class="text-[#FF6F61] hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {profile.profile_url}
                </a>
              {:else}
                <span class="text-gray-400">—</span>
              {/if}
            </td>
            <td class="px-6 py-4 max-w-xs text-gray-600">
              {getField(profile, 'biography') ?? getField(profile, 'bio') ?? '—'}
            </td>
            <td class="px-6 py-4 font-semibold">{formatFollowers(profile.followers)}</td>
            <td class="px-6 py-4 font-semibold">{getFitScore(profile)}</td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>
