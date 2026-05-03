function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function nowSuffix(now: number): string {
  return String(now).replace(/\D/g, "");
}

export function createGameTitleId(name: string, now = Date.now()): string {
  const suffix = slugify(name) || "game_title";
  return `gt_${suffix}_${nowSuffix(now)}`;
}

export function createMapMasterId(name: string, now = Date.now()): string {
  const suffix = slugify(name) || "map";
  return `map_master_${suffix}_${nowSuffix(now)}`;
}

export function createSeasonMasterId(name: string, now = Date.now()): string {
  const suffix = slugify(name) || "season";
  return `season_master_${suffix}_${nowSuffix(now)}`;
}
