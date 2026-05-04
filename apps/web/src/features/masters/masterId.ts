function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toLowerCase();
}

function nowSuffix(now: number): string {
  return String(now).replaceAll(/\D/g, "");
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
