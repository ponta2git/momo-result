import { startTransition, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useAnalysisArtifactRecovery } from "@/shared/api/useAnalysisArtifactRecovery";
import { createDeferred } from "@/test/deferred";
import { makeSeriesAnalysisStatus } from "@/test/msw/seriesAnalysisFixtures";

it("does not restart an expired artifact read when status settles after its owner unmounts", async () => {
  const started = createDeferred();
  const committed = createDeferred();
  const status = makeSeriesAnalysisStatus();
  const response = createDeferred<{ data: typeof status }>();
  const refetchArtifact = vi.fn(async () => undefined);
  const refetchStatus = () => {
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
      queryKey: ["artifact"],
      refetchArtifact,
      refetchStatus,
    });
    return null;
  }
  function Replacement() {
    useLayoutEffect(() => {
      response.resolve({ data: status });
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
    expect(refetchArtifact).not.toHaveBeenCalled();
  } finally {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
  }
});
