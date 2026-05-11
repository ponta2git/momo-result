import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import {
  createMockMediaStream,
  installCanvasElementSpies,
  installVideoElementSpies,
  installVideoReadyController,
} from "@/test/doubles/dom";
import type {
  CanvasElementSpies,
  VideoElementSpies,
  VideoReadyController,
} from "@/test/doubles/dom";

describe("CameraCapture", () => {
  const originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
  let videoSpies: VideoElementSpies;
  let canvasSpies: CanvasElementSpies;
  let videoReady: VideoReadyController;

  beforeEach(() => {
    videoSpies = installVideoElementSpies();
    canvasSpies = installCanvasElementSpies();
    videoReady = installVideoReadyController();
    videoReady.set(true);
  });

  afterEach(() => {
    videoReady.restore();
    canvasSpies.restore();
    videoSpies.restore();
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
    const { stream, track } = createMockMediaStream();
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

    expect(screen.getByRole("button", { name: "静止画を撮影" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));

    expect(screen.getByRole("button", { name: "静止画を撮影" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "停止" }));

    expect(track.stop).toHaveBeenCalled();
    expect(videoSpies.pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "静止画を撮影" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
  });

  it("rejects capture when the video is not yet ready", async () => {
    const user = userEvent.setup();
    const { stream } = createMockMediaStream();
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
    videoReady.set(false);
    await user.click(screen.getByRole("button", { name: "静止画を撮影" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith(expect.stringContaining("カメラの準備"));
  });

  it("guards against double-clicking カメラ開始 while the previous start is in flight", async () => {
    const user = userEvent.setup();
    let resolveStream!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<CameraCapture slotLabel="事件簿" onSelect={vi.fn()} onValidationError={vi.fn()} />);

    const startButton = screen.getByRole("button", { name: "カメラ開始" });
    await user.click(startButton);
    await user.click(screen.getByRole("button", { name: /起動中/u }));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    resolveStream(createMockMediaStream().stream);
  });

  it("captures and emits a file with source=camera once ready", async () => {
    const user = userEvent.setup();
    const { stream } = createMockMediaStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
    });

    const onSelect = vi.fn();
    render(<CameraCapture slotLabel="総資産" onSelect={onSelect} onValidationError={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    await user.click(screen.getByRole("button", { name: "静止画を撮影" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const [file, source] = onSelect.mock.calls[0]!;
    expect(file).toBeInstanceOf(File);
    expect(source).toBe("camera");
  });
});
