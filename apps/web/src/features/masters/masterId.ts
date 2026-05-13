function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replaceAll(/[^a-zA-Z0-9_-]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .toLowerCase();
}

function seedSuffix(seed: number | string): string {
  return String(seed)
    .replaceAll(/[^a-zA-Z0-9]+/gu, "")
    .toLowerCase()
    .slice(0, 18);
}

export function createGameTitleId(name: string, seed: number | string = Date.now()): string {
  const suffix = slugify(name) || "game_title";
  return `gt_${suffix}_${seedSuffix(seed)}`;
}

export function createMapMasterId(name: string, seed: number | string = Date.now()): string {
  const suffix = slugify(name) || "map";
  return `map_master_${suffix}_${seedSuffix(seed)}`;
}

export function createSeasonMasterId(name: string, seed: number | string = Date.now()): string {
  const suffix = slugify(name) || "season";
  return `season_master_${suffix}_${seedSuffix(seed)}`;
}
