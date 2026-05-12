import { http, HttpResponse } from "msw";

export const exportHandlers = [
  http.get("/api/exports/matches", ({ request }) => {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "tsv" ? "tsv" : "csv";
    return new HttpResponse(
      format === "tsv"
        ? "シーズン\tシーズンNo.\r\n今シーズン\t1\r\n"
        : "シーズン,シーズンNo.\r\n今シーズン,1\r\n",
      {
        headers: {
          "Content-Disposition": `attachment; filename="momo-results-all.${format}"`,
          "Content-Type":
            format === "tsv"
              ? "text/tab-separated-values; charset=utf-8"
              : "text/csv; charset=utf-8",
        },
      },
    );
  }),
];
