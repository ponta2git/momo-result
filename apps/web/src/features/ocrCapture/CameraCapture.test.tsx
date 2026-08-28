import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CameraCapture } from "@/features/ocrCapture/CameraCapture";
import { createDeferred } from "@/test/deferred";
import {
  createMockMediaStream,
  installGetUserMediaMock,
  installCanvasElementSpies,
  installVideoElementSpies,
  installVideoReadyController,
} from "@/test/doubles/dom";
import type {
  CanvasElementSpies,
  GetUserMediaController,
  VideoElementSpies,
  VideoReadyController,
} from "@/test/doubles/dom";

describe("CameraCapture", () => {
  let getUserMedia: GetUserMediaController | undefined;
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
    getUserMedia?.restore();
    getUserMedia = undefined;
    videoReady.restore();
    canvasSpies.restore();
    videoSpies.restore();
  });

  it("disables 撮影 / 停止 until the camera is active and stops the stream on 停止", async () => {
    const user = userEvent.setup();
    const { stream, track } = createMockMediaStream();
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(stream));

    const onSelect = vi.fn();
    const onValidationError = vi.fn();
    render(
      <CameraCapture
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );

    const captureButton = screen.getByRole("button", { name: "静止画を撮影" });
    expect(captureButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));

    expect(screen.getByRole("button", { name: "カメラ使用中" })).toBeDisabled();
    expect(captureButton).toBeEnabled();
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
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(stream));

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
    getUserMedia = installGetUserMediaMock(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );

    render(<CameraCapture slotLabel="事件簿" onSelect={vi.fn()} onValidationError={vi.fn()} />);

    const startButton = screen.getByRole("button", { name: "カメラ開始" });
    await user.click(startButton);
    await user.click(screen.getByRole("button", { name: /起動中/u }));

    expect(getUserMedia.getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveStream(createMockMediaStream().stream);
    });
    expect(screen.getByRole("button", { name: "カメラ使用中" })).toBeDisabled();
  });

  it("discards and stops a permission result that resolves after capture is disabled", async () => {
    const user = userEvent.setup();
    const permission = createDeferred<MediaStream>();
    const { stream, track } = createMockMediaStream();
    getUserMedia = installGetUserMediaMock(() => permission.promise);
    const onSelect = vi.fn();
    const onValidationError = vi.fn();
    const view = render(
      <CameraCapture
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    view.rerender(
      <CameraCapture
        disabled
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );

    await act(async () => permission.resolve(stream));

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(videoSpies.play).not.toHaveBeenCalled();
    expect(screen.getByLabelText("総資産のカメラプレビュー")).toHaveProperty("srcObject", null);
    expect(screen.getByRole("button", { name: "カメラ開始" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "静止画を撮影" })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("stops a late permission result after StrictMode unmount", async () => {
    const user = userEvent.setup();
    const permission = createDeferred<MediaStream>();
    const { stream, track } = createMockMediaStream();
    getUserMedia = installGetUserMediaMock(() => permission.promise);
    const view = render(
      <StrictMode>
        <CameraCapture slotLabel="事件簿" onSelect={vi.fn()} onValidationError={vi.fn()} />
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    view.unmount();
    await act(async () => permission.resolve(stream));

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(videoSpies.play).not.toHaveBeenCalled();
  });

  it("continues camera startup when device enumeration is blocked", async () => {
    const user = userEvent.setup();
    const { stream } = createMockMediaStream();
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(stream));
    Object.assign(navigator.mediaDevices, {
      enumerateDevices: vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError")),
    });

    render(<CameraCapture slotLabel="総資産" onSelect={vi.fn()} onValidationError={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));

    expect(getUserMedia.getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "カメラ使用中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "静止画を撮影" })).toBeEnabled();
  });

  it("omits cameras without a selectable id and de-duplicates device options", async () => {
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(createMockMediaStream().stream));
    Object.assign(navigator.mediaDevices, {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          mediaDevice({ deviceId: "", label: "権限付与前のカメラ" }),
          mediaDevice({ deviceId: "camera-1", label: "カメラ 1" }),
          mediaDevice({ deviceId: "camera-1", label: "重複したカメラ" }),
        ]),
    });

    render(<CameraCapture slotLabel="総資産" onSelect={vi.fn()} onValidationError={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: "カメラ" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "ブラウザの既定カメラ" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "カメラ 1" })).toHaveValue("camera-1");
  });

  it("promotes the file fallback when camera permission is denied", async () => {
    const user = userEvent.setup();
    getUserMedia = installGetUserMediaMock(() =>
      Promise.reject(new DOMException("blocked", "NotAllowedError")),
    );

    render(
      <CameraCapture
        slotLabel="総資産"
        onSelect={vi.fn()}
        onValidationError={vi.fn()}
        renderFallback={(prominent) => (
          <span>{prominent ? "ファイル追加を表示" : "ファイル追加を控えめに表示"}</span>
        )}
      />,
    );

    expect(screen.getByText("ファイル追加を控えめに表示")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "カメラ開始" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("カメラを利用できません");
    expect(screen.getByText("ファイル追加を表示")).toBeInTheDocument();
    expect(screen.queryByText("ファイル追加を控えめに表示")).not.toBeInTheDocument();
  });

  it("does not promote the file fallback after a completed tray rejects camera access", async () => {
    const user = userEvent.setup();
    getUserMedia = installGetUserMediaMock(() =>
      Promise.reject(new DOMException("blocked", "NotAllowedError")),
    );

    render(
      <CameraCapture
        actionVariant="secondary"
        slotLabel="総資産"
        onSelect={vi.fn()}
        onValidationError={vi.fn()}
        renderFallback={(prominent) => (
          <span>{prominent ? "ファイル追加を表示" : "ファイル追加を控えめに表示"}</span>
        )}
      />,
    );

    const startButton = screen.getByRole("button", { name: "カメラ開始" });
    await user.click(startButton);
    expect(await screen.findByRole("alert")).toHaveTextContent("ファイル追加を控えめに表示");
    expect(screen.queryByText("ファイル追加を表示")).not.toBeInTheDocument();
  });

  it("captures and emits a file with source=camera once ready", async () => {
    const user = userEvent.setup();
    const { stream } = createMockMediaStream();
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(stream));

    const onSelect = vi.fn();
    render(<CameraCapture slotLabel="総資産" onSelect={onSelect} onValidationError={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    await user.click(screen.getByRole("button", { name: "静止画を撮影" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const [file, source] = onSelect.mock.calls[0]!;
    expect(file).toBeInstanceOf(File);
    expect(source).toBe("camera");
  });

  it("keeps a restarted camera capture pending when an obsolete toBlob completes", async () => {
    const user = userEvent.setup();
    const first = createMockMediaStream();
    const second = createMockMediaStream();
    const streams = [first.stream, second.stream];
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(streams.shift()!));
    const blobCallbacks: BlobCallback[] = [];
    canvasSpies.toBlob.mockImplementation((callback: BlobCallback) => {
      blobCallbacks.push(callback);
    });
    const onSelect = vi.fn();
    const onValidationError = vi.fn();
    const view = render(
      <CameraCapture
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    await user.click(screen.getByRole("button", { name: "静止画を撮影" }));
    expect(blobCallbacks).toHaveLength(1);

    view.rerender(
      <CameraCapture
        disabled
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );
    view.rerender(
      <CameraCapture
        slotLabel="総資産"
        onSelect={onSelect}
        onValidationError={onValidationError}
      />,
    );
    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    await user.click(screen.getByRole("button", { name: "静止画を撮影" }));
    expect(blobCallbacks).toHaveLength(2);

    await act(async () => blobCallbacks[0]?.(new Blob(["obsolete"], { type: "image/png" })));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onValidationError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "撮影中…" })).toBeDisabled();
    expect(first.track.stop).toHaveBeenCalledTimes(1);
    expect(second.track.stop).not.toHaveBeenCalled();

    await act(async () => blobCallbacks[1]?.(new Blob(["current"], { type: "image/png" })));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[1]).toBe("camera");
    expect(screen.getByRole("button", { name: "静止画を撮影" })).toBeEnabled();
  });

  it("drops a toBlob completion and releases the preview after unmount", async () => {
    const user = userEvent.setup();
    const { stream, track } = createMockMediaStream();
    getUserMedia = installGetUserMediaMock(() => Promise.resolve(stream));
    let completeBlob: BlobCallback | undefined;
    canvasSpies.toBlob.mockImplementation((callback: BlobCallback) => {
      completeBlob = callback;
    });
    const onSelect = vi.fn();
    const onValidationError = vi.fn();
    const view = render(
      <CameraCapture slotLabel="収益" onSelect={onSelect} onValidationError={onValidationError} />,
    );

    await user.click(screen.getByRole("button", { name: "カメラ開始" }));
    const preview = screen.getByLabelText("収益のカメラプレビュー") as HTMLVideoElement;
    expect(preview.srcObject).toBe(stream);
    await user.click(screen.getByRole("button", { name: "静止画を撮影" }));

    view.unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(preview.srcObject).toBeNull();

    await act(async () => completeBlob?.(new Blob(["late"], { type: "image/png" })));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onValidationError).not.toHaveBeenCalled();
  });
});

function mediaDevice({ deviceId, label }: { deviceId: string; label: string }): MediaDeviceInfo {
  return {
    deviceId,
    groupId: "group-1",
    kind: "videoinput",
    label,
    toJSON: () => ({}),
  };
}
