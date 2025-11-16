# Campaign Page Refactoring Plan

## Overview
The campaign page (`src/routes/(app)/campaign/[id]/+page.svelte`) is currently over 2,000 lines long and needs to be broken down into smaller, maintainable components.

## Current Structure Analysis

### Main Sections:
1. **Script Section** (~1,200 lines)
   - Type definitions
   - State management (30+ state variables)
   - API functions (loadConversation, loadPipelineStatus, etc.)
   - Event handlers
   - Effects and lifecycle hooks

2. **Chat Tab Panel** (~300 lines)
   - Message list rendering
   - Chat input form
   - Progress bar
   - Influencer search form (embedded)

3. **Outreach Tab Panel** (~500 lines)
   - Pipeline status display
   - Influencers table
   - Search form (standalone)
   - Selection bottom bar

4. **Modals/Panels** (already components)
   - OutreachPanel
   - OutreachUpgradePanel
   - SearchLimitExceededPanel

## Proposed Component Structure

```
src/lib/
├── components/
│   └── campaign/
│       ├── CampaignTabs.svelte          # Tab navigation
│       ├── CampaignLoadingCover.svelte  # Loading overlay
│       ├── ChatTab.svelte                # Entire chat tab
│       │   ├── MessageList.svelte       # Message rendering
│       │   ├── ChatInput.svelte         # Input form
│       │   ├── ProgressBar.svelte       # Progress indicator
│       │   └── InfluencerSearchForm.svelte # Embedded search form
│       └── OutreachTab.svelte           # Entire outreach tab
│           ├── PipelineStatus.svelte    # Pipeline progress
│           ├── InfluencersTable.svelte  # Influencers list
│           └── InfluencerSearchForm.svelte # Standalone search form
├── composables/
│   ├── useCampaign.ts                   # Campaign state & API
│   └── usePipeline.ts                   # Pipeline state & API
├── types/
│   └── campaign.ts                      # Shared TypeScript types
└── utils/
    └── campaign.ts                      # Utility functions
```

## Component Breakdown

### 1. Types (`src/lib/types/campaign.ts`)
**Extract:**
- `MessageSource`
- `ApiMessage`
- `ConversationResponse`
- `PipelineStatus` (with all nested types)
- `Influencer` interface
- Any other shared types

### 2. CampaignTabs Component
**Props:**
- `activeTab: 'chat' | 'outreach'`
- `hasUserMessages: boolean`
- `onTabChange: (tab: 'chat' | 'outreach') => void`

**Responsibilities:**
- Render tab buttons
- Handle tab switching
- Show/hide outreach tab based on user messages

### 3. ChatTab Component
**Props:**
- `campaignId: string | null`
- `messages: ApiMessage[]`
- `isInitializing: boolean`
- `initError: string | null`
- `draft: string`
- `isSending: boolean`
- `collected: Record<string, string | undefined>`
- `followerRange: { min: number | null; max: number | null }`
- `progress: number`
- `isProgressComplete: boolean`
- `influencerSummary: string`
- `searchFormTopN: number`
- `searchFormMinFollowers: number | null`
- `searchFormMaxFollowers: number | null`
- `isSearchFormSubmitting: boolean`
- `effectiveCampaign: SerializedCampaign | null`
- `maxInfluencers: number`
- `debugMode: boolean`

**Events:**
- `onSubmit: (message: string) => void`
- `onSearchSubmit: (params: SearchParams) => void`
- `onRetry: () => void`

**Responsibilities:**
- Render message list
- Handle chat input
- Show progress bar
- Show influencer search form when ready
- Manage scroll behavior

### 4. MessageList Component
**Props:**
- `messages: ApiMessage[]`
- `isSending: boolean`

**Responsibilities:**
- Render individual messages
- Handle message types (intro, text, summary)
- Show sources tooltips
- Render loading state

### 5. ChatInput Component
**Props:**
- `draft: string`
- `disabled: boolean`
- `onSubmit: (message: string) => void`

**Responsibilities:**
- Input field
- Submit button
- Form handling

### 6. ProgressBar Component
**Props:**
- `progress: number`
- `showDebug: boolean`

**Events:**
- `onToggleDebug: () => void`

**Responsibilities:**
- Display progress percentage
- Show progress bar
- Debug toggle button

### 7. InfluencerSearchForm Component
**Props:**
- `mode: 'embedded' | 'standalone'`
- `summary: string`
- `topN: number`
- `minFollowers: number | null`
- `maxFollowers: number | null`
- `maxInfluencers: number`
- `isSubmitting: boolean`
- `hasPipeline: boolean`
- `debugMode?: boolean`

**Events:**
- `onSubmit: (params: SearchParams) => void`

**Responsibilities:**
- Render search form (compact or full)
- Handle form submission
- Show appropriate UI based on mode

### 8. OutreachTab Component
**Props:**
- `effectiveCampaign: SerializedCampaign | null`
- `pipelineStatus: PipelineStatus | null`
- `searchUsage: SearchUsage | null`
- `selectedInfluencerIds: Set<string>`
- `contactedInfluencerIds: Set<string>`
- `showContacted: boolean`
- `selectedCount: number`
- `isFreePlan: boolean`

**Events:**
- `onToggleInfluencer: (id: string) => void`
- `onToggleContacted: () => void`
- `onSendOutreach: () => void`
- `onSearchSubmit: (params: SearchParams) => void`

**Responsibilities:**
- Render pipeline status or search form
- Show influencers table
- Handle influencer selection
- Show selection bottom bar

### 9. PipelineStatus Component
**Props:**
- `status: PipelineStatus`
- `onLoadStatus: (pipelineId: string) => void`

**Responsibilities:**
- Display pipeline progress
- Show stage statuses
- Display error messages
- Show estimated time remaining

### 10. InfluencersTable Component
**Props:**
- `profiles: Influencer[]`
- `selectedIds: Set<string>`
- `contactedIds: Set<string>`
- `showContacted: boolean`
- `status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled'`
- `previousProfileIds: Set<string>`

**Events:**
- `onToggleSelection: (id: string) => void`
- `onToggleContacted: () => void`

**Responsibilities:**
- Render influencers table
- Handle selection
- Show contacted/uncontacted filter
- Display empty states
- Animate new profiles

### 11. CampaignLoadingCover Component
**Props:**
- `isLoading: boolean`

**Responsibilities:**
- Show blur overlay
- Display loading spinner
- Show loading message

### 12. Composables

#### useCampaign.ts
**Exports:**
- `loadConversation(campaignId: string): Promise<void>`
- `sendMessage(campaignId: string, message: string): Promise<void>`
- `applyConversationSnapshot(data: ConversationResponse): void`
- State: `messages`, `campaignId`, `collected`, `keywords`, `followerRange`, `isInitializing`, `initError`, `isSending`

#### usePipeline.ts
**Exports:**
- `loadPipelineStatus(pipelineId: string): Promise<void>`
- `startPipelinePolling(pipelineId: string): void`
- `stopPipelinePolling(): void`
- `loadSearchUsage(): Promise<void>`
- `submitSearch(params: SearchParams): Promise<void>`
- State: `pipelineStatus`, `searchUsage`, `isSearching`, `searchError`

### 13. Utils (`src/lib/utils/campaign.ts`)
**Exports:**
- `getProfileId(profile: Influencer): string`
- `formatFollowerRange(range: { min: number | null; max: number | null }): string`
- `getPlatformLogo(platform: string): string`
- `getPlatformColor(platform: string): string`
- `calculateProgress(collected: Record<string, any>, followerRange: {...}): number`
- `simpleHash(str: string): string`

## Refactoring Steps

### Phase 1: Extract Types and Utils
1. Create `src/lib/types/campaign.ts` with all types
2. Create `src/lib/utils/campaign.ts` with utility functions
3. Update imports in main page

### Phase 2: Extract Composables
1. Create `useCampaign.ts` composable
2. Create `usePipeline.ts` composable
3. Move state and API logic to composables
4. Update main page to use composables

### Phase 3: Extract UI Components (Bottom-Up)
1. **ProgressBar** - Smallest, least dependencies
2. **ChatInput** - Simple form component
3. **MessageList** - Message rendering
4. **InfluencerSearchForm** - Search form (used in both tabs)
5. **PipelineStatus** - Pipeline display
6. **InfluencersTable** - Table component
7. **CampaignTabs** - Tab navigation
8. **CampaignLoadingCover** - Loading overlay

### Phase 4: Extract Tab Components
1. **ChatTab** - Combine MessageList, ChatInput, ProgressBar, InfluencerSearchForm
2. **OutreachTab** - Combine PipelineStatus, InfluencersTable, InfluencerSearchForm

### Phase 5: Refactor Main Page
1. Replace inline code with components
2. Use composables for state management
3. Reduce main page to ~200-300 lines
4. Keep only high-level orchestration logic

### Phase 6: Testing & Cleanup
1. Test all functionality
2. Fix any broken imports
3. Ensure state management works correctly
4. Verify all events and callbacks
5. Check for any performance issues

## Benefits

1. **Maintainability**: Each component has a single responsibility
2. **Reusability**: Components can be reused in other contexts
3. **Testability**: Smaller components are easier to test
4. **Readability**: Main page becomes much easier to understand
5. **Performance**: Better code splitting and lazy loading opportunities
6. **Collaboration**: Multiple developers can work on different components

## Estimated File Sizes After Refactoring

- `+page.svelte`: ~200-300 lines (from 2,100+)
- `ChatTab.svelte`: ~150-200 lines
- `OutreachTab.svelte`: ~200-250 lines
- `MessageList.svelte`: ~100-150 lines
- `InfluencersTable.svelte`: ~200-250 lines
- `PipelineStatus.svelte`: ~100-150 lines
- `InfluencerSearchForm.svelte`: ~150-200 lines
- Other components: ~50-100 lines each
- Composables: ~200-300 lines each
- Types/Utils: ~100-150 lines each

## Notes

- Keep backward compatibility during refactoring
- Test incrementally after each phase
- Use Svelte 5 runes ($state, $derived, $effect) consistently
- Ensure proper prop drilling vs context usage
- Consider using Svelte stores for deeply nested state if needed

