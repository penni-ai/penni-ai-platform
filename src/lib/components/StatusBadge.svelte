<script lang="ts">
  type Status = 'confirmed' | 'collected' | 'not_collected' | 'pending' | 'error' | 'success' | 'warning' | 'info';

  interface Props {
    status: Status;
    label?: string;
    size?: 'sm' | 'md';
  }

  let { status, label, size = 'sm' }: Props = $props();

  const config: Record<Status, { bg: string; text: string; defaultLabel: string }> = {
    confirmed: {
      bg: 'rgba(16, 185, 129, 0.1)',
      text: 'rgb(6, 95, 70)',
      defaultLabel: 'Confirmed'
    },
    collected: {
      bg: 'rgba(59, 130, 246, 0.1)',
      text: 'rgb(30, 64, 175)',
      defaultLabel: 'Collected'
    },
    not_collected: {
      bg: 'rgba(245, 158, 11, 0.1)',
      text: 'rgb(146, 64, 14)',
      defaultLabel: 'Not Collected'
    },
    pending: {
      bg: 'rgba(107, 114, 128, 0.1)',
      text: 'rgb(55, 65, 81)',
      defaultLabel: 'Pending'
    },
    error: {
      bg: 'rgba(239, 68, 68, 0.1)',
      text: 'rgb(153, 27, 27)',
      defaultLabel: 'Error'
    },
    success: {
      bg: 'rgba(16, 185, 129, 0.1)',
      text: 'rgb(6, 95, 70)',
      defaultLabel: 'Success'
    },
    warning: {
      bg: 'rgba(245, 158, 11, 0.1)',
      text: 'rgb(146, 64, 14)',
      defaultLabel: 'Warning'
    },
    info: {
      bg: 'rgba(59, 130, 246, 0.1)',
      text: 'rgb(30, 64, 175)',
      defaultLabel: 'Info'
    }
  };

  const { bg, text, defaultLabel } = $derived(config[status]);
  const displayLabel = $derived(label ?? defaultLabel);
  const sizeClass = $derived(size === 'sm' ? 'badge-sm' : 'badge-md');
</script>

<span
  class="status-badge {sizeClass}"
  style="background-color: {bg}; color: {text};"
>
  {displayLabel}
</span>

<style>
  .status-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    font-weight: 500;
    white-space: nowrap;
  }

  .badge-sm {
    padding: 0.125rem 0.5rem;
    font-size: 0.625rem;
  }

  .badge-md {
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
  }
</style>
