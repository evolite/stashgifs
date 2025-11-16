# Stash API Tags Documentation

## Overview

This document explains how tags work in the Stash GraphQL API, specifically for scene markers. Understanding this is critical for implementing filters correctly.

## Scene Marker Tag Structure

A scene marker in Stash has two types of tag associations:

1. **`primary_tag`** - A single tag that is the marker's primary category (required)
2. **`tags`** - An array of additional tags associated with the marker (optional)

### Example Marker Structure

```typescript
{
  id: "123",
  title: "Example Marker",
  seconds: 45,
  primary_tag: {
    id: "100",
    name: "Cowgirl"
  },
  tags: [
    { id: "200", name: "POV" },
    { id: "300", name: "StashGifs Favorite" },
    { id: "400", name: "Anal" }
  ],
  scene: { ... }
}
```

In this example:
- **Primary tag**: "Cowgirl" (id: 100) - the main category
- **Additional tags**: "POV", "StashGifs Favorite", "Anal" - supplementary tags

## Filtering by Tags

Stash's `SceneMarkerFilterType` supports filtering by tags, but it's important to understand what each filter does:

### Filtering by `primary_tag`

When you filter by `primary_tag`, you're filtering markers where the specified tag is the marker's primary tag.

**GraphQL Filter:**
```json
{
  "scene_marker_filter": {
    "tags": {
      "value": ["100"],
      "modifier": "INCLUDES_ALL",
      "depth": 0
    }
  }
}
```

**What this matches:**
- ✅ Markers where "Cowgirl" (id: 100) is the primary tag
- ❌ Markers where "Cowgirl" is only in the tags array

**When to use:**
- Filtering by category tags (e.g., "Cowgirl", "Missionary", "Blowjob")
- Most tag searches where you want the primary category

### Filtering by `tags` Array

When you filter by the `tags` array, you're filtering markers that have the specified tag anywhere in their tags array (not just as primary tag).

**GraphQL Filter:**
```json
{
  "scene_marker_filter": {
    "tags": {
      "value": ["300"],
      "modifier": "INCLUDES_ALL",
      "depth": 0
    }
  }
}
```

**What this matches:**
- ✅ Markers where "StashGifs Favorite" (id: 300) is in the tags array
- ✅ Markers where "StashGifs Favorite" is the primary tag (if it were)
- ❌ Markers that don't have this tag at all

**When to use:**
- Filtering by favorites (favorite tag is in tags array, not primary_tag)
- Filtering by supplementary tags (e.g., "POV", "Anal", "StashGifs Marker")
- Any tag that is added to markers via `addTagToMarker()` (goes to tags array)

## Important Distinctions

### How Tags Are Added

1. **Primary Tag**: Set when marker is created, cannot be changed via `addTagToMarker()`
2. **Tags Array**: Modified via `addTagToMarker()` and `removeTagFromMarker()`

### Example: Favorites

When a user favorites a marker:
- The "StashGifs Favorite" tag is added to the marker's `tags` array
- It is NOT set as the `primary_tag`
- Therefore, filtering favorites MUST use `tags` filter, not `primary_tags` filter

**Correct Filter for Favorites:**
```typescript
{
  tags: [favoriteTagId],  // ✅ Correct - filters by tags array
  // primary_tags: [favoriteTagId]  // ❌ Wrong - won't find favorited markers
}
```

**Incorrect Filter (won't work):**
```typescript
{
  primary_tags: [favoriteTagId],  // ❌ Wrong - favorite tag is not primary_tag
}
```

## Code Implementation

### In FeedContainer.applyFilters()

```typescript
// For favorites - use tags filter
if (selectedTagName === 'Favorites') {
  tags = [String(selectedTagId)];  // Use tags array filter
}

// For other tags - use primary_tags filter
else {
  primaryTags = [String(selectedTagId)];  // Use primary_tag filter
}

const filters: FilterOptions = {
  tags: tags,              // For favorites
  primary_tags: primaryTags,  // For category tags
  // ...
};
```

### In StashAPI.fetchSceneMarkers()

The API handles both filters:

```typescript
// Prefers tags filter if provided, falls back to primary_tags
const tagFilter = filters?.tags || filters?.primary_tags;

if (tagFilter && tagFilter.length > 0) {
  sceneMarkerFilter.tags = {
    value: tagIds.map(id => String(id)),
    modifier: tagIds.length === 1 ? 'INCLUDES_ALL' : 'INCLUDES',
    depth: 0
  };
}
```

**Note**: Both `filters.tags` and `filters.primary_tags` use the same GraphQL filter field (`scene_marker_filter.tags`), but they filter different parts of the marker:
- `filters.tags` → filters markers with tag in `tags` array
- `filters.primary_tags` → filters markers with tag as `primary_tag`

## Filter Modifiers

- **`INCLUDES_ALL`**: Marker must have ALL specified tags (for single tag, same as INCLUDES)
- **`INCLUDES`**: Marker must have ANY of the specified tags (OR logic)
- **`EXCLUDES`**: Marker must NOT have any of the specified tags

For single tag filtering, both `INCLUDES` and `INCLUDES_ALL` work the same way.

## Summary

| Filter Type | What It Filters | Example Use Case |
|------------|----------------|-----------------|
| `primary_tags` | Markers where tag is the primary_tag | Category tags like "Cowgirl", "Missionary" |
| `tags` | Markers where tag is in tags array | Favorites, supplementary tags, plugin tags |

**Key Rule**: 
- If a tag is added via `addTagToMarker()` → use `tags` filter
- If filtering by category/primary tag → use `primary_tags` filter

## Common Mistakes

1. **Using `primary_tags` for favorites**: Won't work because favorite tag is in tags array
2. **Using `tags` for category searches**: May work but less precise (could match tags array instead of primary)
3. **Not understanding the difference**: Leads to filters that don't return expected results

## Testing

To verify a filter works correctly:

1. Check the marker structure - is the tag in `primary_tag` or `tags` array?
2. Use the appropriate filter type
3. Verify the GraphQL query uses `scene_marker_filter.tags` with correct tag IDs
4. Confirm results match expectations




