import { z } from "zod";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(24, "Username must be at most 24 characters.")
    .regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only."),
  // Normalizing here (rather than at every callsite) means every consumer --
  // apps/web/app/api/auth/register, apps/api/app/api/auth/register,
  // apps/api/app/api/auth/mobile/register -- gets a consistently-cased email
  // out of `.parse()`. Existing `.toLowerCase()` calls at those callsites
  // become redundant, not incorrect (idempotent), so nothing else needs to change.
  email: z
    .string()
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be at most 72 characters.")
    .regex(/[a-zA-Z]/, "Password must contain at least one letter.")
    .regex(/[0-9]/, "Password must contain at least one number.")
});
