<script lang="ts">
  import { browser } from '$app/environment';

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
  >
    <div class="popup-content">
      <div class="popup-header">
        <h3 id="inbox-popup-title" class="popup-title">Connected Inboxes</h3>
        <button class="close-btn" onclick={onClose} aria-label="Close">×</button>
      </div>

      <div class="popup-body">
        {#if connections.length === 0}
          <div class="empty-state">
            <div class="empty-icon">📬</div>
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
                  <div class="connection-id">ID: {connection.id.slice(0, 8)}...</div>
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
            + Connect New Inbox
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
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
    padding: 20px;
  }

  .popup-content {
    background: white;
    border-radius: 16px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
    max-width: 500px;
    width: 100%;
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  .popup-title {
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: rgba(0, 0, 0, 0.4);
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.7);
  }

  .popup-body {
    padding: 24px;
  }

  .empty-state {
    text-align: center;
    padding: 32px 16px;
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }

  .empty-text {
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1a;
    margin: 0 0 8px 0;
  }

  .empty-subtext {
    font-size: 14px;
    color: rgba(0, 0, 0, 0.5);
    margin: 0;
  }

  .connections-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
  }

  .connection-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    background: rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .connection-item:hover {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.12);
  }

  .connection-info {
    flex: 1;
    min-width: 0;
  }

  .connection-email {
    font-size: 14px;
    font-weight: 500;
    color: #1a1a1a;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .primary-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: linear-gradient(135deg, #FF6F61, #FF8A80);
    color: white;
    font-size: 11px;
    font-weight: 600;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .connection-id {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.4);
    font-family: monospace;
  }

  .connection-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 8px;
    border: 1px solid;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .set-primary-btn {
    background: transparent;
    border-color: rgba(0, 0, 0, 0.15);
    color: rgba(0, 0, 0, 0.6);
  }

  .set-primary-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.25);
    color: rgba(0, 0, 0, 0.8);
  }

  .set-primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .disconnect-btn {
    background: transparent;
    border-color: rgba(239, 68, 68, 0.2);
    color: #dc2626;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .disconnect-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.3);
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
    padding-top: 16px;
    border-top: 1px solid rgba(0, 0, 0, 0.08);
  }

  .connect-btn {
    width: 100%;
    padding: 14px 20px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #FF6F61, #FF8A80);
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 16px rgba(255, 111, 97, 0.25);
  }

  .connect-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(255, 111, 97, 0.35);
  }
</style>
