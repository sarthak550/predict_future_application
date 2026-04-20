import { redirect } from "next/navigation";

/**
 * The API workspace has no UI. Redirect any browser visit to the health
 * endpoint so developers know the server is alive without seeing a stale
 * HTML page that pretends to be documentation.
 */
export default function ApiRootPage() {
  redirect("/api/health");
}
