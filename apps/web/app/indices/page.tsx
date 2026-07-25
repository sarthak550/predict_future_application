import { redirect } from "next/navigation";

/**
 * The /indices DIRECTORY page was removed 2026-07-25 (founder: the global
 * search's category filters replace it — searching by category "Indices"
 * covers discovery). The per-index detail pages (/indices/[slug]) remain:
 * they are the search results' destinations.
 */
export default function IndicesDirectoryRemoved() {
  redirect("/");
}
