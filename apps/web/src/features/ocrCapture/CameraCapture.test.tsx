import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraCapture } from "@/features/ocrCapture/CameraCapture";

type FakeTrack = { stop: ReturnType<typeof vi.fn>; readyState: "live" | "ended" };

function makeStream(): { stream: MediaStream; track: FakeTrack } {
  const track: FakeTrack = {
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
    readyState: "live",
  };
  const stream = {
    getTracks: () => [track as unknown as MediaStreamTrack],
    get active() {
      return track.readyState === "live";
    },
  } as unknown as MediaStream;
  return { stream, track };
}

function setVideoReady(ready: boolean) {
  Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
    configurable: true,
    get: () => (ready ? 4 : 0),
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => (ready ? 640 : 0),
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => (ready ? 480 : 0),
  });
}

describe("CameraCapture", () => {
  const originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
  const playSpy = vi.fn(() => Promise.resolve());
  const pauseSpy = vi.fn();
  const toBlobSpy = vi.fn((cb: BlobCallback) => {
    cb(new Blob(["x"], { type: "image/png" }));
  });

  beforeEach(() => {
    HTMLVideoElement.prototype.play = playSpy as unknown as HTMLVideoElement["play"];
    HTMLVideoElement.prototype.pause = pauseSpy as unknown as HTMLVideoElement["pause"];
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    ) as unknown as HTMLCanvasElement["getContext"];
    HTMLCanvasElement.prototype.toBlob = toBlobSpy as unknown as HTMLCanvasElement["toBlob"];
    setVideoReady(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalGetUserMedia && navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: originalGetUserMedia,
      });
    }
  });

  it("disables 撮影 / 停止 until the camera is active and stops the stream on 停止", async () => {
    const user = userEvent.setup();
    const { stream, track } = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
    });

    const onSelect = vi.fn();
    const onValidationError = vi.fn();
    render(
      <CameraCapture
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );

    expect(screen.getByRole("button", { name: "撮影" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));

    expect(screen.getByRole("button", { name: "撮影" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "停止" }));

    expect(track.stop).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "撮影" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
  });

  it("rejects capture when the video is not yet ready", async () => {
    const user = userEvent.setup();
    const { stream } = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
    });

    const onSelect = vi.fn();
    const onValidationError = vi.fn();
    render(
      <CameraCapture slotLabel="収益" onSelect={onSelect} onValidationError={onValidationError} />,
    );

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    setVideoReady(false);
    await user.click(screen.getByRole("button", { name: "撮影" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith(expect.stringContaining("カメラの準備"));
  });

  it("guards against double-clicking カメラ開始 while the previous start is in flight", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          setTimeout(() => resolve(makeStream().stream), 30);
        }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<CameraCapture slotLabel="事件簿" onSelect={vi.fn()} onValidationError={vi.fn()} />);

    const startButton = screen.getByRole("button", { name: "カメラ開始" });
    await user.click(startButton);
    await user.click(screen.getByRole("button", { name: /起動中/ }));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("captures and emits a file with source=camera once ready", async () => {
    const user = userEvent.setup();
    const { stream } = makeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
    });

    const onSelect = vi.fn();
    render(<CameraCapture slotLabel="総資産" onSelect={onSelect} onValidationError={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    await user.click(screen.getByRole("button", { name: "撮影" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const [file, source] = onSelect.mock.calls[0]!;
    expect(file).toBeInstanceOf(File);
    expect(source).toBe("camera");
  });
});
