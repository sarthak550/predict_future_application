/**
 * Quest definitions — canonical list of daily quest types, their goals,
 * reward amounts, and human-readable descriptions.
 *
 * These are kept as plain data (not DB rows) so the engine can reference them
 * without an extra query. If a quest type is removed here it stops being
 * issued to new users; existing completed rows remain for history.
 */

export type QuestType = "PREDICT_3" | "PREDICT_5" | "VOTE_ON_POLL" | "CREATE_MARKET";

export type QuestDefinition = {
  questType: QuestType;
  description: string;
  /** Number of qualifying actions required to complete this quest. */
  goal: number;
  /** Points awarded when the quest is completed (credited as QUEST_REWARD). */
  rewardAmount: number;
};

export const QUEST_DEFINITIONS: QuestDefinition[] = [
  {
    questType: "PREDICT_3",
    description: "Make 3 predictions today",
    goal: 3,
    rewardAmount: 50,
  },
  {
    questType: "PREDICT_5",
    description: "Make 5 predictions today",
    goal: 5,
    rewardAmount: 100,
  },
  {
    questType: "VOTE_ON_POLL",
    description: "Cast a poll vote today",
    goal: 1,
    rewardAmount: 25,
  },
  {
    questType: "CREATE_MARKET",
    description: "Create a market today",
    goal: 1,
    rewardAmount: 75,
  },
];

/** Map from questType to its definition for O(1) lookup. */
export const QUEST_DEF_MAP: Record<QuestType, QuestDefinition> = Object.fromEntries(
  QUEST_DEFINITIONS.map((d) => [d.questType, d])
) as Record<QuestType, QuestDefinition>;
