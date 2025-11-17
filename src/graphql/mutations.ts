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
 * Add O-count to a scene
 */
export const SCENE_ADD_O = `
  mutation SceneAddO($id: ID!, $times: [Timestamp!]) {
    sceneAddO(id: $id, times: $times) {
      id
      o_counter
    }
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

