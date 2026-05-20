/**
 * Feature flags — simple boolean constants that gate in-progress or A/B features.
 *
 * To flip a flag: change the value here and rebuild. The founder / QA engineer
 * can toggle these during review without touching product code.
 *
 * NEVER read flags inside server-side or shared packages — mobile-only concerns live here.
 */

/**
 * S34-T1: Redesigned ExpertOpinionPostCard for the Finance feed.
 *
 * When true, the Finance feed (finance-mode.tsx), story detail (story/[id].tsx),
 * and any other opinion-rendering surface swap the legacy ExpertOpinionCard for
 * the new ExpertOpinionPostCard.
 *
 * The old ExpertOpinionCard + ExpertOpinionRow are NOT deleted — they remain in
 * place so the flag can be flipped back safely.
 *
 * Set to false to revert to the old row-based design.
 */
export const USE_POST_CARD = true;
