/**
 * GraphQL Mutations
 * Centralized mutation definitions
 */

import { TagFields } from './fragments.js';

/**
 * Create a new tag
 */
export const TAG_CREATE = `
  ${TagFields}
  mutation TagCreate($input: TagCreateInput!) {
    tagCreate(input: $input) {
      ...TagFields
    }
  }
`;

/**
 * Update a scene marker
 */
export const SCENE_MARKER_UPDATE = `
  mutation SceneMarkerUpdate($id: ID!, $title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!]!) {
    sceneMarkerUpdate(
      input: {
        id: $id
        title: $title
        seconds: $seconds
        end_seconds: $end_seconds
        scene_id: $scene_id
        primary_tag_id: $primary_tag_id
        tag_ids: $tag_ids
      }
    ) {
      id
    }
  }
`;

/**
 * Create a new scene marker
 */
export const SCENE_MARKER_CREATE = `
  ${TagFields}
  mutation SceneMarkerCreate($title: String!, $seconds: Float!, $end_seconds: Float, $scene_id: ID!, $primary_tag_id: ID!, $tag_ids: [ID!] = []) {
    sceneMarkerCreate(
      input: {title: $title, seconds: $seconds, end_seconds: $end_seconds, scene_id: $scene_id, primary_tag_id: $primary_tag_id, tag_ids: $tag_ids}
    ) {
      id
      title
      seconds
      end_seconds
      stream
      preview
      screenshot
      scene {
        id
        title
        files {
          width
          height
          path
        }
        performers {
          id
          name
          image_path
        }
      }
      primary_tag {
        ...TagFields
      }
      tags {
        ...TagFields
      }
    }
  }
`;

/**
 * Update a scene
 */
export const SCENE_UPDATE = `
  mutation SceneUpdate($input: SceneUpdateInput!) {
    sceneUpdate(input: $input) {
      id
    }
  }
`;

/**
 * Add/remove tags on scenes server-side (tag_ids mode ADD/REMOVE) — no read-modify-write.
 */
export const BULK_SCENE_UPDATE = `
  mutation BulkSceneUpdate($input: BulkSceneUpdateInput!) {
    bulkSceneUpdate(input: $input) {
      id
      tags {
        id
      }
    }
  }
`;

/**
 * Add O-count to a scene
 */
export const SCENE_ADD_O = `
  mutation SceneAddO($id: ID!, $times: [Timestamp!]) {
    sceneAddO(id: $id, times: $times) {
      count
    }
  }
`;

/**
 * Increment the play count for a scene
 */
export const SCENE_INCREMENT_PLAY_COUNT = `
  mutation SceneIncrementPlayCount($id: ID!) {
    sceneIncrementPlayCount(id: $id)
  }
`;

/**
 * Save scene watch activity (resume position and total play duration)
 */
export const SCENE_SAVE_ACTIVITY = `
  mutation SceneSaveActivity($id: ID!, $resume_time: Float, $playDuration: Float!) {
    sceneSaveActivity(id: $id, resume_time: $resume_time, playDuration: $playDuration)
  }
`;

/**
 * Update an image
 */
export const IMAGE_UPDATE = `
  mutation ImageUpdate($input: ImageUpdateInput!) {
    imageUpdate(input: $input) {
      id
    }
  }
`;

/**
 * Increment O-count for an image
 */
export const IMAGE_INCREMENT_O = `
  mutation ImageIncrementO($id: ID!) {
    imageIncrementO(id: $id)
  }
`;

/**
 * Update a performer
 */
export const PERFORMER_UPDATE = `
  mutation PerformerUpdate($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) {
      id
      favorite
    }
  }
`;

/**
 * Save plugin configuration
 */
export const CONFIGURE_PLUGIN = `
  mutation ConfigurePlugin($plugin_id: ID!, $input: Map!) {
    configurePlugin(plugin_id: $plugin_id, input: $input)
  }
`;
