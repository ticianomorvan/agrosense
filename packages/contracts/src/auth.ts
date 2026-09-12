import { z } from "zod";

export const authConfigResponseSchema = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  }, "Supabase must use HTTPS outside local development"),
  publishableKey: z.string().min(1).max(500),
});
export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>;
