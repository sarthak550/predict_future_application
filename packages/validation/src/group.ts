import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().min(3, "Group name is too short.").max(80),
  description: z.string().max(280).optional().or(z.literal(""))
});

export const joinGroupSchema = z.object({
  inviteCode: z
    .string()
    .min(4, "Invite code is too short.")
    .max(32)
    .transform((value) => value.trim().toUpperCase())
});
