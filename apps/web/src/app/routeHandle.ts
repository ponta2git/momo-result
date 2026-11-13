import { useMatches } from "react-router-dom";

/**
 * The global navigation area a route belongs to. Pages that record a match (capture, review,
 * entry, drafts) belong to 記録する, whatever their path prefix.
 */
export type NavArea =
  | "record"
  | "heldEvents"
  | "matches"
  | "analytics"
  | "achievements"
  | "adminAnalysis"
  | "adminMasters";

/** Route metadata, declared beside each route: its browser title and navigation area. */
export type RouteHandle = {
  readonly navArea?: NavArea;
  readonly title: string;
};

function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    value !== null &&
    typeof value === "object" &&
    "title" in value &&
    typeof value.title === "string"
  );
}

/** Reads the deepest matched route's metadata. */
export function useRouteHandle(): RouteHandle | undefined {
  const handle: unknown = useMatches().at(-1)?.handle;
  return isRouteHandle(handle) ? handle : undefined;
}
