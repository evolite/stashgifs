/**
 * Performer tier badge — laurel-wreath avatar embellishment derived from rating100.
 * Box math (viewBox 58x58, avatar face 40px, wreath overhang) and leaf tables are
 * fixed constants; do not "simplify" the per-tier angle/size arrays, they're tuned
 * so paired leaves read as a continuous wreath silhouette instead of a dotted arc.
 */
import { normalizeMediaUrl } from '../utils.js';

export type PerformerTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'rainbow';

interface TierTokens {
  ring: string;
  ringWidth: number;
  leafA: string;
  leafB: string;
}

const TIER_TOKENS: Record<PerformerTier, TierTokens> = {
  bronze: { ring: '#F0997B', ringWidth: 1, leafA: '#F5C4B3', leafB: '#F0997B' },
  silver: { ring: '#B4B2A9', ringWidth: 2, leafA: '#D3D1C7', leafB: '#B4B2A9' },
  gold: { ring: '#EF9F27', ringWidth: 2, leafA: '#FAC775', leafB: '#EF9F27' },
  platinum: { ring: '#5DCAA5', ringWidth: 2, leafA: '#9FE1CB', leafB: '#5DCAA5' },
  diamond: { ring: '#85B7EB', ringWidth: 2, leafA: '#B5D4F4', leafB: '#85B7EB' },
  // ring/leafA/leafB unused: rainbow tier draws a segmented ring and per-slot rainbow leaves instead.
  rainbow: { ring: '#FF5252', ringWidth: 2, leafA: '#FF5252', leafB: '#FF5252' },
};

// [angleDegrees, rx, ry] — each entry mirrored at +angle and -angle
const WREATH: Record<PerformerTier, Array<[number, number, number]>> = {
  bronze: [[36, 3.5, 6]],
  silver: [[34, 3.5, 6], [54, 3.2, 5.5]],
  gold: [[32, 3.5, 6], [52, 3.2, 5.5], [72, 2.9, 5]],
  platinum: [[30, 3.5, 6], [50, 3.2, 5.5], [70, 2.9, 5], [90, 2.6, 4.5]],
  diamond: [[28, 3.5, 6], [48, 3.2, 5.5], [68, 2.9, 5], [88, 2.6, 4.5], [108, 2.3, 4]],
  rainbow: [[26, 3.5, 6], [46, 3.2, 5.5], [66, 2.9, 5], [86, 2.6, 4.5], [106, 2.3, 4], [126, 2.0, 3.5]],
};

// Red -> violet. Assigned by position (innermost leaf / first ring segment = red), never by rating.
const RAINBOW = ['#FF5252', '#FF9800', '#FFEB3B', '#4CAF50', '#2196F3', '#9C27B0'];

const DISC_FILL = '#6b5a52';
const SVG_NS = 'http://www.w3.org/2000/svg';

// [floor, tier] — first match wins, checked high to low. rating100 <= 0 (or unrated) gets no badge.
const TIER_THRESHOLDS: Array<[number, PerformerTier]> = [
  [100, 'rainbow'],
  [96, 'diamond'],
  [80, 'platinum'],
  [65, 'gold'],
  [50, 'silver'],
  [1, 'bronze'],
];

/** rating100 (0-100) -> tier. undefined = unrated, no badge. */
export function performerTierFromRating100(rating100: number | undefined | null): PerformerTier | undefined {
  if (!rating100) return undefined;
  return TIER_THRESHOLDS.find(([floor]) => rating100 >= floor)?.[1];
}

/** Ring color/width for a tier — for framing a performer image elsewhere (e.g. the hover overlay portrait). */
export function tierRingStyle(tier: PerformerTier): { color: string; width: number } {
  const tokens = TIER_TOKENS[tier];
  return { color: tokens.ring, width: tokens.ringWidth };
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function leafGroup(angle: number, rx: number, ry: number, fill: string): SVGElement {
  const g = svgEl('g', { transform: `rotate(${angle})` });
  g.appendChild(svgEl('ellipse', { cx: 0, cy: 22.5, rx, ry, fill }));
  return g;
}

/**
 * A ring that happens to be six colours, built from six stacked circles each drawing two
 * opposite dash segments — NOT a <linearGradient> (that produces a two-tone smear on a
 * circle, not a spectrum, and flashes on DOM updates). 12 segments (6 colours x 2) must
 * abut with no gaps, so seg = circumference / 12 is recomputed from the actual radius
 * every call — never hardcode another radius's numbers here.
 */
function buildRainbowRing(radius: number, strokeWidth: number): SVGElement {
  const group = svgEl('g', {});
  const seg = (2 * Math.PI * radius) / 12;
  const dasharray = `${seg.toFixed(2)} ${(seg * 5).toFixed(2)}`;
  RAINBOW.forEach((color, i) => {
    group.appendChild(svgEl('circle', {
      r: radius,
      fill: 'none',
      stroke: color,
      'stroke-width': strokeWidth,
      'stroke-dasharray': dasharray,
      'stroke-dashoffset': (-(seg * i)).toFixed(2),
    }));
  });
  return group;
}

/** CSS gradient for a perfect (rating100 === 100) score's portrait border / top rule — both flat rectangles, not rings, so a CSS linear-gradient reads fine there (the dasharray rule only applies to circular strokes). */
export const PERFECT_RATING_GRADIENT = 'linear-gradient(135deg, #FF5252, #FF9800, #FFEB3B, #4CAF50, #2196F3, #9C27B0)';

export function formatRatingValue10(value10: number): string {
  return Number.isInteger(value10) ? String(value10) : value10.toFixed(1);
}

export interface PerformerTierBadgeOptions {
  performerId: string;
  name: string;
  tier: PerformerTier;
  imagePath?: string;
  initial: string;
  verified: boolean;
  /** Knockout stroke color for the verified check — must match whatever surface the badge sits on. */
  knockoutColor: string;
}

/** Draw order: leaves -> ring -> disc/image -> initials -> check. */
export function buildPerformerTierBadge(options: PerformerTierBadgeOptions): SVGSVGElement {
  const tokens = TIER_TOKENS[options.tier];
  const svg = svgEl('svg', { width: 58, height: 58, viewBox: '0 0 58 58' }) as SVGSVGElement;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${options.name}, ${options.tier} tier${options.verified ? ', verified' : ''}`);

  const isRainbow = options.tier === 'rainbow';
  const group = svgEl('g', { transform: 'translate(29 29)' });

  WREATH[options.tier].forEach(([angle, rx, ry], i) => {
    const fill = isRainbow ? RAINBOW[i % RAINBOW.length] : (i % 2 === 0 ? tokens.leafA : tokens.leafB);
    group.appendChild(leafGroup(angle, rx, ry, fill));
    group.appendChild(leafGroup(-angle, rx, ry, fill));
  });

  if (isRainbow) {
    group.appendChild(buildRainbowRing(18, tokens.ringWidth));
  } else {
    group.appendChild(svgEl('circle', { r: 19, fill: 'none', stroke: tokens.ring, 'stroke-width': tokens.ringWidth }));
  }

  const imageUrl = options.imagePath ? normalizeMediaUrl(options.imagePath) : undefined;
  if (imageUrl) {
    const clipId = `av-tier-${options.performerId}`;
    const defs = svgEl('defs', {});
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 18 }));
    defs.appendChild(clip);
    group.appendChild(defs);
    group.appendChild(svgEl('circle', { r: 18, fill: DISC_FILL }));
    const image = svgEl('image', { x: -18, y: -18, width: 36, height: 36, 'clip-path': `url(#${clipId})` });
    image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    image.setAttribute('href', imageUrl);
    group.appendChild(image);
  } else {
    group.appendChild(svgEl('circle', { r: 18, fill: DISC_FILL }));
    const text = svgEl('text', { x: 0, y: 6, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 600, fill: '#fff' });
    text.textContent = options.initial;
    group.appendChild(text);
  }

  if (options.verified) {
    const check = svgEl('g', { class: 'performer-chip__verified' });
    check.appendChild(svgEl('circle', { cx: 13.5, cy: 13.5, r: 7.5, fill: '#e8621f', stroke: options.knockoutColor, 'stroke-width': 2 }));
    check.appendChild(svgEl('path', {
      d: 'M10 13.6 L12.4 16 L17 11.2', fill: 'none', stroke: '#fff', 'stroke-width': 1.8,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
    group.appendChild(check);
  }

  svg.appendChild(group);
  return svg;
}
