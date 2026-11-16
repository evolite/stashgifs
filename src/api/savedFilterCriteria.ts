import type { SceneMarkerFilterInput } from '../graphql/types.js';

const RESOLUTION_ENUMS: Record<string, string> = {
  '144p': 'VERY_LOW', '240p': 'LOW', '360p': 'R360P', '480p': 'STANDARD', '540p': 'WEB_HD',
  '720p': 'STANDARD_HD', '1080p': 'FULL_HD', '1440p': 'QUAD_HD', '4k': 'FOUR_K', '5k': 'FIVE_K',
  '6k': 'SIX_K', '7k': 'SEVEN_K', '8k': 'EIGHT_K', '8k+': 'HUGE',
};

const TEXT_CRITERIA = new Set(['title', 'details', 'path', 'url', 'code', 'photographer', 'checksum', 'name']);

function flattenSavedRange(key: string, modifier: string | undefined, range: { value?: unknown; value2?: unknown }): unknown {
  const isNullCheck = modifier === 'IS_NULL' || modifier === 'NOT_NULL';
  const hasValue = range.value !== null && range.value !== undefined;
  if (!hasValue && !isNullCheck) return undefined;
  const fallback = TEXT_CRITERIA.has(key) ? '' : 0;
  const hasValue2 = range.value2 !== null && range.value2 !== undefined;
  return {
    ...(modifier ? { modifier } : {}),
    value: hasValue ? range.value : fallback,
    ...(hasValue2 ? { value2: range.value2 } : {}),
  };
}

function normalizeSavedCriterion(key: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;

  const crit = raw as { modifier?: string; value?: unknown };
  if (!('modifier' in crit) && !('value' in crit)) return raw;

  const { modifier, value } = crit;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return 'value' in value ? flattenSavedRange(key, modifier, value) : undefined;
  }
  const resolved = key === 'resolution' && typeof value === 'string'
    ? (RESOLUTION_ENUMS[value.toLowerCase()] ?? value)
    : value;
  return { ...(modifier ? { modifier } : {}), value: resolved };
}

export function normalizeSavedObjectFilter<T = SceneMarkerFilterInput>(input: unknown): T {
  if (!input || typeof input !== 'object') return {} as T;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const idStrings = new Set(['tags', 'scene_tags', 'performer_tags', 'studios', 'galleries']);
  const idNumbers = new Set(['scene_performers', 'performers']);
  const dropped: string[] = [];

  for (const key of Object.keys(out)) {
    const value = out[key];
    let normalized: unknown;
    if (idStrings.has(key)) normalized = normalizeTagFieldAsStrings(value);
    else if (idNumbers.has(key)) normalized = normalizeTagFieldAsNumbers(value);
    else if (key === 'AND' || key === 'OR' || key === 'NOT' || key.endsWith('_filter')) {
      normalized = value && typeof value === 'object' ? normalizeSavedObjectFilter<Record<string, unknown>>(value) : undefined;
    } else normalized = normalizeSavedCriterion(key, value);

    if (normalized === undefined) {
      delete out[key];
      dropped.push(key);
    } else {
      out[key] = normalized;
    }
  }

  if (dropped.length > 0) console.warn('[savedFilterCriteria] Saved filter criteria ignored (unsupported format):', dropped.join(', '));
  return out as T;
}

function extractId(x: unknown): unknown {
  if (typeof x === 'object' && x !== null) {
    const obj = x as { id?: unknown; value?: unknown };
    return obj.id ?? obj.value ?? x;
  }
  return x;
}

function normalizeIdArray(val: unknown): number[] | undefined {
  if (!val) return undefined;
  const arr = Array.isArray(val) ? val : [val];
  const ids = arr
    .map((x) => extractId(x))
    .map((x) => Number.parseInt(String(x), 10))
    .filter((n) => !Number.isNaN(n));
  return ids.length > 0 ? ids : undefined;
}

function normalizeTagFieldAsStrings(fieldValue: unknown): unknown {
  return normalizeTagField(fieldValue, (values) => values.map(String));
}

function normalizeTagFieldAsNumbers(fieldValue: unknown): unknown {
  return normalizeTagField(fieldValue, (values) => values.map(Number));
}

function normalizeTagField(
  fieldValue: unknown,
  normalizeValueArray: (values: number[]) => Array<string | number>
): unknown {
  if (!fieldValue) return undefined;

  type TagsModifier = 'INCLUDES' | 'INCLUDES_ALL' | 'EXCLUDES';

  const normalizeFieldValue = (rawValue: unknown): number[] | undefined => {
    let raw = rawValue;
    if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)) {
      raw = (raw as { items: unknown[] }).items;
    }
    return normalizeIdArray(raw);
  };

  if (Array.isArray(fieldValue)) {
    const ids = normalizeIdArray(fieldValue);
    if (!ids) return undefined;
    return {
      value: normalizeValueArray(ids),
      modifier: 'INCLUDES' as TagsModifier
    };
  }

  if (typeof fieldValue === 'object') {
    const fieldObj = fieldValue as {
      value?: unknown;
      modifier?: TagsModifier;
      excludes?: unknown;
      depth?: number | string;
      include_subtags?: boolean | number | string;
    };
    const valueObj = fieldObj.value as { depth?: unknown; include_subtags?: unknown; excludes?: unknown; modifier?: TagsModifier } | undefined;
    const ids = normalizeFieldValue(fieldObj.value);
    if (!ids) return undefined;

    const excludesSource = fieldObj.excludes ?? valueObj?.excludes;
    const normalizedExcludes = normalizeFieldValue(excludesSource);
    const depthSource = fieldObj.depth ?? valueObj?.depth;
    const includeSubtags = fieldObj.include_subtags ?? valueObj?.include_subtags;
    const depth = resolveTagDepth(depthSource, includeSubtags);

    return {
      value: normalizeValueArray(ids),
      modifier: fieldObj.modifier ?? valueObj?.modifier ?? 'INCLUDES',
      ...(normalizedExcludes ? { excludes: normalizeValueArray(normalizedExcludes) } : {}),
      ...(Number.isFinite(depth) ? { depth } : {})
    };
  }

  return undefined;
}

function resolveTagDepth(depthSource: unknown, includeSubtags: unknown): number | undefined {
  if (typeof depthSource === 'number') {
    return depthSource;
  }
  if (typeof depthSource === 'string') {
    return Number.parseInt(depthSource, 10);
  }
  if (includeSubtags === true) {
    return 1;
  }
  if (typeof includeSubtags === 'string') {
    return Number.parseInt(includeSubtags, 10);
  }
  if (typeof includeSubtags === 'number') {
    return includeSubtags;
  }
  return undefined;
}
