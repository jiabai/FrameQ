import { z } from "zod";

export const emailStartSchema = z.object({
  email: z.string(),
  state: z.string(),
});

export const emailVerifySchema = z.object({
  email: z.string(),
  code: z.string(),
  state: z.string(),
});
