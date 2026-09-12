import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Write only after successful generation so failed authentication preserves types.
const output = execFileSync(
  "pnpm",
  [
    "exec",
    "supabase",
    "gen",
    "types",
    "typescript",
    "--linked",
    "--schema",
    "public",
  ],
  { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
);
if (!output.includes("export type Database"))
  throw new Error("Supabase did not return database types");
writeFileSync(
  new URL("../apps/api/src/lib/database.types.ts", import.meta.url),
  output,
);
execFileSync(
  "pnpm",
  ["exec", "biome", "check", "--write", "apps/api/src/lib/database.types.ts"],
  { stdio: "inherit" },
);
