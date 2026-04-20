import { existsSync, readFileSync } from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

loadWorkspaceEnv();

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

function loadWorkspaceEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env")
  ];

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    const raw = readFileSync(candidatePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      process.env[key] = value;
    }

    break;
  }
}
