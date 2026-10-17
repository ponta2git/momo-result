import { act, renderHook } from "@testing-library/react";
import { startTransition, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";
import { createDeferred } from "@/test/deferred";
import { makeSeriesAnalysisStatus } from "@/test/msw/seriesAnalysisFixtures";

it("does not retry a different selection when an old publication check completes", async () => {
  const started = createDeferred();
  const publication = createDeferred<string | undefined>();
  const refreshResource = vi.fn(async () => undefined);
  const refreshPublication = () => {
    started.resolve();
    return publication.promise;
  };
  const error = {
    kind: "api",
    code: "ANALYSIS_ARTIFACT_EXPIRED",
    title: "expired",
    detail: "expired",
  };
  const initialProps: { resourceId: string; failure: unknown } = {
    resourceId: "member-a",
    failure: error,
  };
  const { rerender } = renderHook(
    ({ resourceId, failure }: { resourceId: string; failure: unknown }) =>
      useAnalysisArtifactRecovery({
        artifactId: "publication-1",
        resourceId,
        error: failure,
        refreshResource,
        refreshPublication,
      }),
    { initialProps },
  );

  await started.promise;
  rerender({ resourceId: "member-b", failure: undefined });
  await act(async () => publication.resolve("publication-1"));

  expect(refreshResource).not.toHaveBeenCalled();
});

it("does not restart an expired artifact read when status settles after its owner unmounts", async () => {
  const started = createDeferred();
  const committed = createDeferred();
  const status = makeSeriesAnalysisStatus();
  const response = createDeferred<string | undefined>();
  const refreshResource = vi.fn(async () => undefined);
  const refreshPublication = () => {
    started.resolve();
    return response.promise;
  };
  function Resource() {
    useAnalysisArtifactRecovery({
      artifactId: status.currentArtifact?.artifactId,
      error: {
        kind: "api",
        code: "ANALYSIS_ARTIFACT_EXPIRED",
        title: "expired",
        detail: "expired",
      },
      resourceId: "artifact",
      refreshResource,
      refreshPublication,
    });
    return null;
  }
  function Replacement() {
    useLayoutEffect(() => {
      response.resolve(status.currentArtifact?.artifactId);
      committed.resolve();
    }, []);
    return <p>別の画面</p>;
  }

  // act flushes passive cleanup before promise continuations, concealing this race.
  // Use React's actual transition commit and resolve the response in that commit.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    root.render(<Resource />);
    await started.promise;
    startTransition(() => root.render(<Replacement />));
    await committed.promise;
    expect(container).toHaveTextContent("別の画面");
    expect(refreshResource).not.toHaveBeenCalled();
  } finally {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
  }
});
