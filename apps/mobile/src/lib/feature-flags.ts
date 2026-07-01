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

/**
 * Phone-verification prompt (S25-T6).
 *
 * OFF for launch: phone OTP needs MSG91 + DLT template/sender approval, which is
 * still pending. Login is email + password and does NOT require a verified phone,
 * so the optional "+100 pts — verify your phone" card is hidden entirely to avoid
 * dangling users into a flow that can't complete.
 *
 * Flip back to true once MSG91_TEMPLATE_ID + MSG91_SENDER_ID (DLT) are live in prod.
 */
export const SHOW_PHONE_VERIFY = false;
