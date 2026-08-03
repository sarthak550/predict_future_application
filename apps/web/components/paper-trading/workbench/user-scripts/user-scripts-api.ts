/**
 * User Strategy Scripting (SS2) — thin fetch wrappers around SS1's CRUD
 * routes (`/api/user-scripts`, `/api/user-scripts/[id]`). Kept in its own
 * file (rather than inlined in `script-editor-drawer.tsx`) so the drawer's
 * own state-orchestration logic doesn't get tangled up with response-shape
 * parsing and error-string extraction — every function here returns a
 * plain, never-throwing result union the caller can branch on directly, the
 * same posture `use-chart-drawings.ts` uses for its own fetch calls.
 */

export interface UserScriptRow {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export type UserScriptsResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

export async function listUserScripts(): Promise<UserScriptsResult<UserScriptRow[]>> {
  try {
    const res = await fetch("/api/user-scripts");
    if (!res.ok) {
      return { ok: false, status: res.status, error: await readErrorMessage(res, "Couldn't load your scripts.") };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, data: Array.isArray(data?.scripts) ? data.scripts : [] };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server — check your connection." };
  }
}

export async function createUserScript(name: string, source: string): Promise<UserScriptsResult<UserScriptRow>> {
  try {
    const res = await fetch("/api/user-scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, source })
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await readErrorMessage(res, "Couldn't save this script.") };
    }
    const data = await res.json().catch(() => null);
    if (!data?.script) return { ok: false, status: res.status, error: "Couldn't save this script." };
    return { ok: true, data: data.script as UserScriptRow };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server — check your connection." };
  }
}

export async function updateUserScript(id: string, patch: { name?: string; source?: string }): Promise<UserScriptsResult<UserScriptRow>> {
  try {
    const res = await fetch(`/api/user-scripts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await readErrorMessage(res, "Couldn't save your changes.") };
    }
    const data = await res.json().catch(() => null);
    if (!data?.script) return { ok: false, status: res.status, error: "Couldn't save your changes." };
    return { ok: true, data: data.script as UserScriptRow };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server — check your connection." };
  }
}

export async function deleteUserScript(id: string): Promise<UserScriptsResult<true>> {
  try {
    const res = await fetch(`/api/user-scripts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await readErrorMessage(res, "Couldn't delete this script.") };
    }
    return { ok: true, data: true };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server — check your connection." };
  }
}
