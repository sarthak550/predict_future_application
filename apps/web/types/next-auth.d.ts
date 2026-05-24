import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      username: string;
      role: "USER" | "ADMIN" | "MODERATOR";
      isSuspended: boolean;
    };
  }

  interface User {
    username: string;
    role: "USER" | "ADMIN" | "MODERATOR";
    isSuspended: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: "USER" | "ADMIN" | "MODERATOR";
    username?: string;
    isSuspended?: boolean;
    refreshedAt?: number;
  }
}
