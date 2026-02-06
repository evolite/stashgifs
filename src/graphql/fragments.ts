/**
 * GraphQL Fragments
 * Reusable field selections to reduce duplication
 */

/**
 * Fragment for Scene fields used across multiple queries
 */
export const SceneFields = `
  fragment SceneFields on Scene {
    id
    title
    date
    details
    url
    rating100
    o_counter
    studio {
      id
      name
    }
    performers {
      id
      name
      favorite
      image_path
      stash_ids {
        stash_id
      }
    }
    tags {
      id
      name
    }
    files {
      id
      path
      size
      duration
      video_codec
      audio_codec
      width
      height
      bit_rate
    }
    paths {
      screenshot
      preview
      stream
      webp
      vtt
    }
    sceneStreams {
      url
      mime_type
      label
    }
  }
`;

/**
 * Fragment for SceneMarker fields
 */
export const SceneMarkerFields = `
  fragment SceneMarkerFields on SceneMarker {
    id
    title
    seconds
    end_seconds
    stream
    primary_tag {
      id
      name
    }
    tags {
      id
      name
    }
  }
`;

/**
 * Fragment for Tag fields (minimal)
 */
export const TagFields = `
  fragment TagFields on Tag {
    id
    name
  }
`;

/**
 * Fragment for Tag fields (extended - for select/search)
 */
export const TagFieldsExtended = `
  fragment TagFieldsExtended on Tag {
    id
    name
    sort_name
    favorite
    description
    aliases
    image_path
    parents {
      id
      name
      sort_name
    }
  }
`;

/**
 * Fragment for Performer fields (minimal)
 */
export const PerformerFields = `
  fragment PerformerFields on Performer {
    id
    name
    image_path
    stash_ids {
      stash_id
    }
  }
`;

/**
 * Fragment for Performer fields (extended - for hover overlay)
 * Fields verified to work in Stash GraphQL schema
 */
export const PerformerFieldsExtended = `
  fragment PerformerFieldsExtended on Performer {
    id
    name
    image_path
    gender
    favorite
    details
    url
    birthdate
    height_cm
    weight
    measurements
    ethnicity
    hair_color
    eye_color
    country
    rating100
    stash_ids {
      stash_id
    }
    tags {
      id
      name
    }
  }
`;

/**
 * Fragment for Image fields (slim - for feed display)
 */
export const SlimImageData = `
  fragment SlimImageData on Image {
    id
    title
    code
    date
    urls
    details
    photographer
    rating100
    organized
    o_counter
    paths {
      thumbnail
      preview
      image
    }
    galleries {
      id
      title
      files {
        path
      }
      folder {
        path
      }
    }
    studio {
      id
      name
      image_path
    }
    tags {
      id
      name
    }
    performers {
      id
      name
      gender
      favorite
      image_path
      stash_ids {
        stash_id
      }
    }
    visual_files {
      ...VisualFileData
    }
  }
`;

/**
 * Fragment for VisualFile fields
 */
export const VisualFileData = `
  fragment VisualFileData on VisualFile {
    ... on BaseFile {
      id
      path
      size
      mod_time
      fingerprints {
        type
        value
      }
    }
    ... on ImageFile {
      id
      path
      size
      mod_time
      width
      height
      fingerprints {
        type
        value
      }
    }
    ... on VideoFile {
      id
      path
      size
      mod_time
      duration
      video_codec
      audio_codec
      width
      height
      frame_rate
      bit_rate
      fingerprints {
        type
        value
      }
    }
  }
`;
