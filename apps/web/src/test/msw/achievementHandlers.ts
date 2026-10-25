import { http, HttpResponse } from "msw";

import { makeAchievementCatalog, makeAchievementResource } from "@/test/msw/achievementFixtures";

export const achievementHandlers = [
  http.get("/api/achievements/catalog", ({ request }) =>
    HttpResponse.json(
      makeAchievementCatalog({
        gameTitleId: new URL(request.url).searchParams.get("gameTitleId") ?? "gt_momotetsu_2",
      }),
    ),
  ),
  http.get("/api/achievements", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const response = makeAchievementResource();
    response.gameTitleId = params.get("gameTitleId") ?? response.gameTitleId;
    response.artifact = {
      ...response.artifact,
      artifactId: params.get("artifactId") ?? response.artifact.artifactId,
      gameTitleId: response.gameTitleId,
    };
    return HttpResponse.json(response);
  }),
];
