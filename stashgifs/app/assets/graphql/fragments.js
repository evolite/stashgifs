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
      image_path
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
  }
`;
//# sourceMappingURL=fragments.js.map