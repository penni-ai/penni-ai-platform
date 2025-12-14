<script lang="ts">
  import { browser } from '$app/environment';
  import { fly, fade } from 'svelte/transition';

  interface GmailConnection {
    id: string;
    email: string;
    primary?: boolean | null;
  }

  interface Props {
    open: boolean;
    connections: GmailConnection[];
    onClose: () => void;
    onConnect: () => void;
    onDisconnect: (connectionId: string) => Promise<void>;
    onSetPrimary: (connectionId: string) => Promise<void>;
  }

  let {
    open,
    connections,
    onClose,
    onConnect,
    onDisconnect,
    onSetPrimary
  }: Props = $props();

  let isDisconnecting = $state<string | null>(null);
  let isSettingPrimary = $state<string | null>(null);

  async function handleDisconnect(connectionId: string, email: string) {
    if (!confirm(`Disconnect ${email}?`)) return;

    isDisconnecting = connectionId;
    try {
      await onDisconnect(connectionId);
    } finally {
      isDisconnecting = null;
    }
  }

  async function handleSetPrimary(connectionId: string) {
    isSettingPrimary = connectionId;
    try {
      await onSetPrimary(connectionId);
    } finally {
      isSettingPrimary = null;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('popup-overlay')) {
      onClose();
    }
  }
</script>

{#if open}
  <div
    class="popup-overlay"
    onclick={handleClickOutside}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="inbox-popup-title"
    tabindex="-1"
    transition:fade={{ duration: 200 }}
  >
    <div class="popup-content" transition:fly={{ y: 20, duration: 300 }}>
      <div class="popup-header">
        <h3 id="inbox-popup-title" class="popup-title">Connected Inboxes</h3>
        <button class="close-btn" onclick={onClose} aria-label="Close">
          <svg class="close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="popup-body">
        {#if connections.length === 0}
          <div class="empty-state">
            <p class="empty-text">No inboxes connected yet</p>
            <p class="empty-subtext">Connect your Gmail to send outreach emails</p>
          </div>
        {:else}
          <div class="connections-list">
            {#each connections as connection (connection.id)}
              <div class="connection-item">
                <div class="connection-info">
                  <div class="connection-email">
                    {connection.email}
                    {#if connection.primary}
                      <span class="primary-badge">Primary</span>
                    {/if}
                  </div>
                  <div class="connection-id">{connection.id.slice(0, 8)}...</div>
                </div>

                <div class="connection-actions">
                  {#if !connection.primary && connections.length > 1}
                    <button
                      class="action-btn set-primary-btn"
                      onclick={() => handleSetPrimary(connection.id)}
                      disabled={isSettingPrimary === connection.id}
                    >
                      {#if isSettingPrimary === connection.id}
                        Setting...
                      {:else}
                        Set Primary
                      {/if}
                    </button>
                  {/if}

                  <button
                    class="action-btn disconnect-btn"
                    onclick={() => handleDisconnect(connection.id, connection.email)}
                    disabled={isDisconnecting === connection.id}
                  >
                    {#if isDisconnecting === connection.id}
                      <span class="spinner-small"></span>
                    {:else}
                      Disconnect
                    {/if}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div class="popup-footer">
          <button class="connect-btn" onclick={onConnect}>
            Connect New Inbox
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .popup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
    padding: 24px;
  }

  .popup-content {
    background: var(--color-bg-elevated);
    border-radius: 0;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
    max-width: 520px;
    width: 100%;
  }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 32px 40px 24px;
    border-bottom: 1px solid var(--color-border);
  }

  .popup-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 24px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .close-btn {
    padding: 8px;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .close-icon {
    width: 20px;
    height: 20px;
  }

  .popup-body {
    padding: 32px 40px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
  }

  .empty-text {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 18px;
    color: var(--color-text);
    margin: 0 0 8px 0;
  }

  .empty-subtext {
    font-size: 14px;
    color: var(--color-text-secondary);
    margin: 0;
  }

  .connections-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-bottom: 32px;
  }

  .connection-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
    border-bottom: 1px solid var(--color-border);
    transition: background 0.2s;
  }

  .connection-item:last-child {
    border-bottom: none;
  }

  .connection-info {
    flex: 1;
    min-width: 0;
  }

  .connection-email {
    font-size: 15px;
    font-weight: 500;
    color: var(--color-text);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .primary-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    background: #FF6F61;
    color: white;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .connection-id {
    font-size: 12px;
    color: var(--color-text-muted);
    font-family: monospace;
  }

  .connection-actions {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .set-primary-btn {
    color: var(--color-text-secondary);
    border-bottom: 1px solid transparent;
  }

  .set-primary-btn:hover:not(:disabled) {
    color: var(--color-text);
    border-bottom-color: var(--color-text);
  }

  .set-primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .disconnect-btn {
    color: #dc2626;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .disconnect-btn:hover:not(:disabled) {
    color: #b91c1c;
  }

  .disconnect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner-small {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(220, 38, 38, 0.3);
    border-top-color: #dc2626;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .popup-footer {
    padding-top: 24px;
    border-top: 1px solid var(--color-border);
  }

  .connect-btn {
    width: 100%;
    padding: 16px 24px;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.02em;
    border: none;
    background: #FF6F61;
    color: white;
    cursor: pointer;
    transition: background 0.2s;
  }

  .connect-btn:hover {
    background: #E85A4F;
  }
</style>
