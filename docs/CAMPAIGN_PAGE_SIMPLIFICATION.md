# Campaign Page Simplification Plan

## Issues Identified

### 1. Dead Code (Unused Functions & State)
- `simpleHash()` - Not used (already in utils)
- `getPlatformLogo()` - Not used (already in utils)
- `getPlatformColor()` - Not used (already in utils)
- `isInfluencerSelected()` - Not used
- `filteredProfiles` derived - Not used (filtering done in InfluencersTable)
- `formatFollowerRange()` - Not used (already in utils)
- `getEstimatedTimeRemaining()` - Not used
- `handleSubmit()` - Not used (ChatTab handles submission)
- `prefetchConversation()` - Prefetches but doesn't use data
- `searchResult` state - Set but never read
- `search` state - Set but never used
- `keywords` state - Set but never used
- `conversationPrefetched` state - Tracks prefetch but doesn't help
- `pipelineStartTime` state - Tracked but never used
- `debugMode` - Check if actually needed

### 2. Complex/Redundant Logic
- **Duplicate search form state**: Two sets of form state (chat vs outreach) that could be unified
- **localCampaign sync**: Multiple effects syncing campaign state - could be simplified
- **Pipeline polling**: Complex cleanup logic with multiple exit points
- **Firestore listener**: Verbose setup with auth state handling
- **Conversation loading**: Prefetch logic that doesn't actually help

### 3. Simplification Opportunities
- Remove prefetch entirely (loads anyway when tab becomes active)
- Simplify localCampaign to single source of truth
- Consolidate pipeline polling cleanup
- Remove unused state variables
- Remove duplicate utility functions (use utils instead)

## Proposed Changes

### Phase 1: Remove Dead Code
1. Remove unused functions
2. Remove unused state variables
3. Remove unused derived values
4. Remove prefetch logic

### Phase 2: Simplify State Management
1. Consider unifying search form state (if feasible)
2. Simplify localCampaign sync logic
3. Simplify pipeline polling cleanup

### Phase 3: Reduce Complexity
1. Consolidate effects where possible
2. Simplify Firestore listener setup
3. Remove debug mode if not needed

## Expected Impact
- Reduce file size by ~200-300 lines
- Improve maintainability
- Reduce potential bugs from unused code
- Simplify mental model

