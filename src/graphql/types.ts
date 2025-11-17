/**
 * GraphQL Type Definitions
 * TypeScript interfaces for GraphQL queries, mutations, and filters
 */

import { Scene, SceneMarker } from '../types.js';

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter modifier for includes/excludes operations
 */
export type FilterModifier = 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES';

/**
 * Filter modifier for comparison operations
 */
export type ComparisonModifier = 'GREATER_THAN' | 'LESS_THAN' | 'EQUALS';

/**
 * FindFilterType - Common filter for pagination and sorting
 */
export interface FindFilterInput {
  q?: string;
  per_page?: number;
  page?: number;
  sort?: string;
  direction?: 'ASC' | 'DESC';
}

/**
 * SceneMarkerFilterType - Filter for scene markers
 */
export interface SceneMarkerFilterInput {
  tags?: {
    value: string[];
    modifier: FilterModifier;
    excludes?: string[];
    depth?: number;
  };
  scene_tags?: {
    value: string[];
    modifier: FilterModifier;
  };
  scene_performers?: {
    value: number[];
    modifier: FilterModifier;
  };
  performers?: {
    value: number[];
    modifier: FilterModifier;
  };
  [key: string]: unknown; // Allow additional filter properties
}

/**
 * SceneFilterType - Filter for scenes
 */
export interface SceneFilterInput {
  has_markers?: string; // 'true' | 'false'
  tags?: {
    value: string[];
    modifier: FilterModifier;
  };
  performers?: {
    value: number[];
    modifier: FilterModifier;
  };
  studios?: {
    value: string[];
    modifier: FilterModifier;
  };
  rating100?: {
    value: number;
    modifier: ComparisonModifier;
  };
  [key: string]: unknown; // Allow additional filter properties
}

/**
 * TagFilterType - Filter for tags
 */
export interface TagFilterInput {
  marker_count?: {
    value: number;
    modifier: ComparisonModifier;
  };
  [key: string]: unknown;
}

/**
 * PerformerFilterType - Filter for performers
 */
export interface PerformerFilterInput {
  scene_count?: {
    value: number;
    modifier: ComparisonModifier;
  };
  [key: string]: unknown;
}

/**
 * ImageFilterType - Filter for images
 */
export interface ImageFilterInput {
  path?: {
    value: string;
    modifier: 'MATCHES_REGEX' | 'NOT_MATCHES_REGEX' | 'EQUALS' | 'NOT_EQUALS' | 'INCLUDES' | 'EXCLUDES';
  };
  performers?: {
    value: number[];
    modifier: FilterModifier;
  };
  tags?: {
    value: string[];
    modifier: FilterModifier;
  };
  [key: string]: unknown; // Allow additional filter properties
}

// ============================================================================
// Query Response Types
// ============================================================================

/**
 * GraphQL response wrapper
 */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * GraphQL error
 */
export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

/**
 * FindSceneMarkers response
 */
export interface FindSceneMarkersResponse {
  findSceneMarkers: {
    count: number;
    scene_markers: SceneMarker[];
  };
}

/**
 * FindScenes response
 */
export interface FindScenesResponse {
  findScenes: {
    count: number;
    scenes: Scene[];
  };
}

/**
 * FindTags response
 */
export interface FindTagsResponse {
  findTags: {
    count?: number;
    tags: Array<{ id: string; name: string }>;
  };
}

/**
 * FindTagsExtended response (for select/search)
 */
export interface FindTagsExtendedResponse {
  findTags: {
    count: number;
    tags: Array<{
      id: string;
      name: string;
      sort_name?: string;
      favorite?: boolean;
      description?: string;
      aliases?: string[];
      image_path?: string;
      parents?: Array<{
        id: string;
        name: string;
        sort_name?: string;
      }>;
    }>;
  };
}

/**
 * FindPerformers response
 */
export interface FindPerformersResponse {
  findPerformers: {
    performers: Array<{ id: string; name: string; image_path?: string }>;
  };
}

/**
 * FindScene response
 */
export interface FindSceneResponse {
  findScene: Scene | null;
}

/**
 * GetSavedMarkerFilters response
 */
export interface GetSavedMarkerFiltersResponse {
  findSavedFilters: Array<{ id: string; name: string }>;
}

/**
 * GetSavedFilter response
 */
export interface GetSavedFilterResponse {
  findSavedFilter: {
    id: string;
    name: string;
    mode: string;
    find_filter?: {
      q?: string;
      per_page?: number;
      page?: number;
    };
    object_filter?: unknown;
  } | null;
}

/**
 * CheckTagsHaveMarkers response
 */
export interface CheckTagsHaveMarkersResponse {
  findSceneMarkers: {
    count: number;
  };
}

/**
 * CheckPerformerHasMarkers response
 */
export interface CheckPerformerHasMarkersResponse {
  findSceneMarkers: {
    count: number;
  };
}

/**
 * FindSceneMarkerTags response
 */
export interface FindSceneMarkerTagsResponse {
  sceneMarkerTags: Array<{
    scene_markers: Array<{
      seconds: number;
    }>;
  }> | {
    scene_markers: Array<{
      seconds: number;
    }>;
  };
}

/**
 * Image type (from Stash GraphQL)
 */
export interface Image {
  id: string;
  title?: string;
  code?: string;
  date?: string;
  urls?: string[];
  details?: string;
  photographer?: string;
  rating100?: number;
  organized?: boolean;
  o_counter?: number;
  paths?: {
    thumbnail?: string;
    preview?: string;
    image?: string;
  };
  galleries?: Array<{
    id: string;
    title?: string;
    files?: Array<{
      path?: string;
    }>;
    folder?: {
      path?: string;
    };
  }>;
  studio?: {
    id: string;
    name: string;
    image_path?: string;
  };
  tags?: Array<{
    id: string;
    name: string;
  }>;
  performers?: Array<{
    id: string;
    name: string;
    gender?: string;
    favorite?: boolean;
    image_path?: string;
  }>;
  visual_files?: Array<VisualFile>;
}

/**
 * VisualFile union type
 */
export interface VisualFile {
  id: string;
  path: string;
  size?: number;
  mod_time?: string;
  fingerprints?: Array<{
    type: string;
    value: string;
  }>;
  width?: number;
  height?: number;
  duration?: number;
  video_codec?: string;
  audio_codec?: string;
  frame_rate?: number;
  bit_rate?: number;
}

/**
 * FindImages response
 */
export interface FindImagesResponse {
  findImages: {
    count: number;
    megapixels?: number;
    filesize?: number;
    images: Image[];
  };
}

// ============================================================================
// Mutation Input Types
// ============================================================================

/**
 * TagCreateInput
 */
export interface TagCreateInput {
  name: string;
}

/**
 * SceneMarkerUpdateInput
 */
export interface SceneMarkerUpdateInput {
  id: string;
  title: string;
  seconds: number;
  end_seconds?: number | null;
  scene_id: string;
  primary_tag_id: string;
  tag_ids: string[];
}

/**
 * SceneMarkerCreateInput
 */
export interface SceneMarkerCreateInput {
  title: string;
  seconds: number;
  end_seconds?: number | null;
  scene_id: string;
  primary_tag_id: string;
  tag_ids?: string[];
}

/**
 * SceneUpdateInput
 */
export interface SceneUpdateInput {
  id: string;
  tag_ids?: string[];
  performer_ids?: string[];
  rating100?: number | null;
  [key: string]: unknown; // Allow additional fields
}

/**
 * SceneAddOInput
 */
export interface SceneAddOInput {
  id: string;
  times?: Array<string>; // Timestamp format
}

// ============================================================================
// Mutation Response Types
// ============================================================================

/**
 * TagCreate response
 */
export interface TagCreateResponse {
  tagCreate: {
    id: string;
    name: string;
  } | null;
}

/**
 * SceneMarkerUpdate response
 */
export interface SceneMarkerUpdateResponse {
  sceneMarkerUpdate: {
    id: string;
  } | null;
}

/**
 * SceneMarkerCreate response
 */
export interface SceneMarkerCreateResponse {
  sceneMarkerCreate: {
    id: string;
    title: string;
    seconds: number;
    end_seconds?: number | null;
    stream?: string;
    preview?: string;
    screenshot?: string;
    scene: {
      id: string;
      title?: string;
      files?: Array<{
        width?: number;
        height?: number;
        path?: string;
      }>;
      performers?: Array<{
        id: string;
        name: string;
        image_path?: string;
      }>;
    };
    primary_tag: {
      id: string;
      name: string;
    };
    tags: Array<{
      id: string;
      name: string;
    }>;
  } | null;
}

/**
 * SceneUpdate response
 */
export interface SceneUpdateResponse {
  sceneUpdate: {
    id: string;
  } | null;
}

/**
 * SceneAddO response
 */
export interface SceneAddOResponse {
  sceneAddO: {
    id: string;
    o_counter?: number;
  } | null;
}

/**
 * ImageUpdate input
 */
export interface ImageUpdateInput {
  id: string;
  tag_ids?: string[];
  o_counter?: number;
}

/**
 * ImageUpdate response
 */
export interface ImageUpdateResponse {
  imageUpdate: {
    id: string;
  } | null;
}

/**
 * ImageIncrementO response
 */
export interface ImageIncrementOResponse {
  imageIncrementO: number;
}

// ============================================================================
// GraphQL Client Types
// ============================================================================

/**
 * Typed GraphQL query options
 */
export interface GraphQLQueryOptions<TVariables = Record<string, unknown>, _TData = unknown> {
  query: string;
  variables?: TVariables;
  signal?: AbortSignal;
}

/**
 * Typed GraphQL mutation options
 */
export interface GraphQLMutationOptions<TVariables = Record<string, unknown>, _TData = unknown> {
  mutation: string;
  variables?: TVariables;
  signal?: AbortSignal;
}


/**
 * Typed GraphQL client interface
 */
export interface TypedGraphQLClient {
  query<TData = unknown, TVariables = Record<string, unknown>>(
    options: GraphQLQueryOptions<TVariables, TData>
  ): Promise<{ data?: TData; errors?: GraphQLError[] }>;
  mutate<TData = unknown, TVariables = Record<string, unknown>>(
    options: GraphQLMutationOptions<TVariables, TData>
  ): Promise<{ data?: TData; errors?: GraphQLError[] }>;
}

