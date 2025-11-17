/**
 * GraphQL Queries
 * Centralized query definitions
 */

import { SceneFields, SceneMarkerFields, TagFields, TagFieldsExtended, PerformerFields, SlimImageData, VisualFileData } from './fragments.js';

/**
 * Check if tags have markers
 */
export const CHECK_TAGS_HAVE_MARKERS = `
  query CheckTagsHaveMarkers($scene_marker_filter: SceneMarkerFilterType) {
    findSceneMarkers(scene_marker_filter: $scene_marker_filter) {
      count
    }
  }
`;

/**
 * Find scene markers with full scene data
 */
export const FIND_SCENE_MARKERS = `
  ${SceneMarkerFields}
  ${SceneFields}
  query FindSceneMarkers($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
    findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
      count
      scene_markers {
        ...SceneMarkerFields
        scene {
          ...SceneFields
        }
      }
    }
  }
`;

/**
 * Get marker count
 */
export const GET_MARKER_COUNT = `
  query GetMarkerCount($filter: FindFilterType, $scene_marker_filter: SceneMarkerFilterType) {
    findSceneMarkers(filter: $filter, scene_marker_filter: $scene_marker_filter) {
      count
    }
  }
`;

/**
 * Find scenes
 */
export const FIND_SCENES = `
  ${SceneFields}
  query FindScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
    findScenes(filter: $filter, scene_filter: $scene_filter) {
      count
      scenes {
        ...SceneFields
        scene_markers {
          id
        }
      }
    }
  }
`;

/**
 * Get scene count
 */
export const GET_SCENE_COUNT = `
  query GetSceneCount($filter: FindFilterType, $scene_filter: SceneFilterType) {
    findScenes(filter: $filter, scene_filter: $scene_filter) {
      count
    }
  }
`;

/**
 * Find tags
 */
export const FIND_TAGS = `
  ${TagFields}
  query FindTags($filter: FindFilterType, $tag_filter: TagFilterType) {
    findTags(filter: $filter, tag_filter: $tag_filter) {
      tags {
        ...TagFields
      }
    }
  }
`;

/**
 * Find tags for select/search (extended fields)
 */
export const FIND_TAGS_FOR_SELECT = `
  ${TagFieldsExtended}
  query FindTagsForSelect($filter: FindFilterType, $tag_filter: TagFilterType, $ids: [ID!]) {
    findTags(filter: $filter, tag_filter: $tag_filter, ids: $ids) {
      count
      tags {
        ...TagFieldsExtended
      }
    }
  }
`;

/**
 * Find performers
 */
export const FIND_PERFORMERS = `
  ${PerformerFields}
  query FindPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType) {
    findPerformers(filter: $filter, performer_filter: $performer_filter) {
      performers {
        ...PerformerFields
      }
    }
  }
`;

/**
 * Find a single scene
 */
export const FIND_SCENE = `
  ${SceneFields}
  query FindScene($id: ID!) {
    findScene(id: $id) {
      ...SceneFields
      tags {
        id
      }
    }
  }
`;

/**
 * Find scene (minimal - for tag checking)
 */
export const FIND_SCENE_MINIMAL = `
  query FindScene($id: ID!) {
    findScene(id: $id) {
      id
      tags {
        id
      }
    }
  }
`;

/**
 * Get saved marker filters
 */
export const GET_SAVED_MARKER_FILTERS = `
  query GetSavedMarkerFilters {
    findSavedFilters(mode: SCENE_MARKERS) {
      id
      name
    }
  }
`;

/**
 * Get a saved filter
 */
export const GET_SAVED_FILTER = `
  query GetSavedFilter($id: ID!) {
    findSavedFilter(id: $id) {
      id
      name
      mode
      find_filter {
        q
        per_page
        page
      }
      object_filter
    }
  }
`;

/**
 * Find scene marker tags
 */
export const FIND_SCENE_MARKER_TAGS = `
  query FindSceneMarkerTags($id: ID!) {
    sceneMarkerTags(scene_id: $id) {
      scene_markers {
        seconds
      }
    }
  }
`;

/**
 * Find images with filtering
 */
export const FIND_IMAGES = `
  ${SlimImageData}
  ${VisualFileData}
  query FindImages($filter: FindFilterType, $image_filter: ImageFilterType, $image_ids: [Int!]) {
    findImages(filter: $filter, image_filter: $image_filter, image_ids: $image_ids) {
      count
      megapixels
      filesize
      images {
        ...SlimImageData
      }
    }
  }
`;

