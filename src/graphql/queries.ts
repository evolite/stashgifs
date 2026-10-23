/**
 * GraphQL Queries
 * Centralized query definitions
 */

import { SceneFields, SceneMarkerFields, TagFields, TagFieldsExtended, PerformerFields, PerformerFieldsExtended, SlimImageData, VisualFileData } from './fragments.js';

/**
 * Get UI configuration
 */
export const GET_UI_CONFIGURATION = `
  query Configuration {
    configuration {
      ui
    }
  }
`;

/**
 * Get plugin configuration
 */
export const GET_PLUGIN_CONFIGURATION = `
  query PluginConfiguration {
    configuration {
      plugins
    }
  }
`;

/**
 * Get stash-box (StashDB, ThePornDB, etc.) configuration
 */
export const GET_STASH_BOX_CONFIG = `
  query GetStashBoxConfig {
    configuration {
      general {
        stashBoxes {
          endpoint
          api_key
          name
        }
      }
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
 * Find studios
 */
export const FIND_STUDIOS = `
  query FindStudios($filter: FindFilterType) {
    findStudios(filter: $filter) {
      studios {
        id
        name
        image_path
      }
    }
  }
`;

/**
 * Find a single studio by ID (for hover overlay)
 */
export const FIND_STUDIO = `
  query FindStudio($id: ID!) {
    findStudio(id: $id) {
      id
      name
      url
      details
      image_path
      rating100
      favorite
      aliases
      parent_studio {
        id
        name
      }
      stash_ids {
        stash_id
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
 * Find a single performer by ID
 * Using findPerformers with ids parameter (similar to findTags)
 */
export const FIND_PERFORMER = `
  ${PerformerFieldsExtended}
  query FindPerformer($ids: [ID!]) {
    findPerformers(ids: $ids) {
      performers {
        ...PerformerFieldsExtended
      }
    }
  }
`;

/**
 * Find scene (minimal - for tag checking)
 */
export const FIND_SCENES_TAG_IDS = `
  query FindScenesTagIds($ids: [ID!], $filter: FindFilterType) {
    findScenes(ids: $ids, filter: $filter) {
      scenes {
        id
        tags {
          id
        }
      }
    }
  }
`;
/**
 * Get saved filters (all modes; callers keep the ones they support)
 */
export const GET_SAVED_FILTERS = `
  query GetSavedFilters {
    findSavedFilters {
      id
      name
      mode
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
 * Find galleries
 */
export const FIND_GALLERIES = `
  query FindGalleries($filter: FindFilterType) {
    findGalleries(filter: $filter) {
      count
      galleries {
        id
        title
        folder {
          path
        }
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
      images {
        ...SlimImageData
      }
    }
  }
`;

