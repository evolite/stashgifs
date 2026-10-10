/**
 * Synthetic "end of content" card shown when the feed has no more content to
 * load. The reel scroller snaps onto it like a real post (it carries
 * data-post-id), so reaching the bottom gives feedback instead of silently
 * clamping on the last card.
 *
 * There's no separate "search" button — the card points an arrow up at the
 * header search bar (which FeedContainer force-shows when this card settles)
 * and focuses it on tap. The footer mirrors the Settings feedback/support links.
 */

import { THEME, toRgba } from './utils.js';

/** Sentinel post id so the reel treats the end card as a snap target. */
export const END_CARD_POST_ID = '__end__';

/** Prompts above the feedback links — one picked at random per build. */
export const FOOTER_PROMPTS: string[] = [
  'Enjoying StashGifs? Say hi or send ideas:',
  'Got a feature in mind? Let me know:',
  'Loving it? Buy me a coffee or drop a line:',
  'Found a bug? Tell me about it:',
  'Ideas, gripes, praise — all welcome:',
  'Help shape what comes next:',
  'Hit me up with requests or feedback:',
  'Like the vibe? Come say hello:',
  'Want something added? Just ask:',
  'Your two cents keep this going:',
  'Come hang out and share your thoughts:',
  'Something feel off? Let me know:',
  'Wishlist a feature or just chat:',
  'Made by one person — say thanks or send ideas:',
  'Keep the suggestions coming:',
  'Tell me what you want to see next:',
  'Feedback fuels the updates:',
  'Spotted something? Want something? Reach out:',
  'Drop a star, a coffee, or an idea:',
  'This is built on your feedback:',
];

/** Feedback/support links — same destinations as the Settings footer. */
const FEEDBACK_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['💬 Discourse', 'https://discourse.stashapp.cc/t/stashgifs-social-media-style-browsing-experience'],
  ['💻 GitHub', 'https://github.com/evolite/stashgifs'],
  ['☕ Coffee', 'https://buymeacoffee.com/evolite'],
];

const STYLE_ID = 'stashgifs-endcard-style';

/** Inject the arrow-bounce keyframe once (mirrors the DiscoveryPanel pattern). */
function ensureKeyframes(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    '@keyframes stashgifs-endcard-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}';
  document.head.appendChild(style);
}

function createFooterLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  Object.assign(link.style, {
    color: THEME.colors.accentPrimary,
    fontSize: THEME.typography.sizeMeta,
    textDecoration: 'none',
    transition: 'color 0.2s ease',
  });
  link.addEventListener('mouseenter', () => { link.style.color = THEME.colors.textPrimary; });
  link.addEventListener('mouseleave', () => { link.style.color = THEME.colors.accentPrimary; });
  return link;
}

/**
 * Build a full-viewport end-of-feed card. `onSearch` runs when the user taps the
 * arrow/hint pointing at the search bar.
 */
export function buildEndOfFeedCard(onSearch: () => void): HTMLElement {
  ensureKeyframes();

  const card = document.createElement('div');
  card.className = 'end-of-feed-card';
  card.dataset.postId = END_CARD_POST_ID;
  const reelHeight = CSS.supports('height', '100svh') ? '100svh' : '100vh';
  Object.assign(card.style, {
    position: 'relative',
    width: '100%',
    height: reelHeight,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '24px 32px calc(40px + env(safe-area-inset-bottom, 0px))',
    boxSizing: 'border-box',
    textAlign: 'center',
    background: `radial-gradient(120% 80% at 50% 0%, ${toRgba(THEME.colors.accentPrimary, 0.18)} 0%, ${THEME.colors.backgroundSecondary} 45%, ${THEME.colors.backgroundPrimary} 100%)`,
    color: THEME.colors.textPrimary,
    fontFamily: THEME.typography.fontFamily,
  });

  // Top — arrow + hint pointing up at the (force-shown) header search bar.
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.setAttribute('aria-label', 'Search for more content');
  hint.title = 'Search for more content';
  Object.assign(hint.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    // Push clear of the header search bar + its selected-tag chip row.
    marginTop: 'calc(140px + env(safe-area-inset-top, 0px))',
    minHeight: '44px',
    padding: '12px 24px',
    border: 'none',
    background: 'transparent',
    color: THEME.colors.textSecondary,
    cursor: 'pointer',
    fontFamily: THEME.typography.fontFamily,
  });
  const arrow = document.createElement('div');
  arrow.textContent = '↑';
  Object.assign(arrow.style, {
    fontSize: '52px',
    lineHeight: '1',
    color: THEME.colors.accentPrimary,
    animation: 'stashgifs-endcard-bounce 1.6s ease-in-out infinite',
  });
  const hintText = document.createElement('span');
  hintText.textContent = 'Search up top for more';
  hintText.style.fontSize = THEME.typography.sizeTitle;
  hintText.style.fontWeight = THEME.typography.weightBodyStrong;
  hint.append(arrow, hintText);
  hint.addEventListener('click', onSearch);

  // Center — feedback/support links, front and centre in the body.
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
  });
  const footerLabel = document.createElement('div');
  footerLabel.textContent = FOOTER_PROMPTS[Math.floor(Math.random() * FOOTER_PROMPTS.length)];
  footerLabel.style.color = THEME.colors.textSecondary;
  footerLabel.style.fontSize = THEME.typography.sizeTitle;
  footerLabel.style.fontWeight = THEME.typography.weightBodyStrong;
  footerLabel.style.maxWidth = '440px';
  const links = document.createElement('div');
  Object.assign(links.style, { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '20px' });
  for (const [label, href] of FEEDBACK_LINKS) {
    const link = createFooterLink(label, href);
    link.style.fontSize = THEME.typography.sizeBody;
    links.appendChild(link);
  }
  footer.append(footerLabel, links);

  card.append(hint, footer);
  return card;
}
