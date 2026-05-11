import { useCallback, useEffect, useRef, useState } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";
import { Button } from "@/shared/ui/actions/Button";

type CameraCaptureProps = {
  disabled?: boolean;
  slotLabel: string;
  onSelect: (file: File, source: InputSource) => void;
  onValidationError: (message: string) => void;
};

function stopStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function CameraCapture({
  disabled = false,
  slotLabel,
  onSelect,
  onValidationError,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    void (async () => {
      const items = await navigator.mediaDevices.enumerateDevices();
      setDevices(items.filter((item) => item.kind === "videoinput"));
    })();
  }, []);

  useEffect(() => {
    if (disabled) {
      stop();
    }
  }, [disabled, stop]);

  useEffect(() => {
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  async function startCamera() {
    if (startingRef.current) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("このブラウザではカメラ撮影が使えません。アップロードを使ってください。");
      return;
    }

    startingRef.current = true;
    setStarting(true);
    try {
      stopStream(streamRef.current);
      streamRef.current = null;

      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      streamRef.current = nextStream;
      if (navigator.mediaDevices.enumerateDevices) {
        const items = await navigator.mediaDevices.enumerateDevices();
        setDevices(items.filter((item) => item.kind === "videoinput"));
      }

      const video = videoRef.current;
      if (!video) {
        stopStream(nextStream);
        streamRef.current = null;
        return;
      }

      video.srcObject = nextStream;
      try {
        await video.play();
      } catch (playError) {
        // play() can reject with AbortError when interrupted by srcObject changes
        // or autoplay policies. If the stream is still live we keep going so the
        // user can retry capture; otherwise surface the error.
        if (!nextStream.active) {
          throw playError;
        }
      }
      setActive(true);
      setError(null);
    } catch (caught) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setActive(false);
      setError(caught instanceof Error ? caught.message : "カメラを開始できませんでした。");
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const stream = streamRef.current;
    if (!video || !canvas || !stream) {
      return;
    }
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      onValidationError("カメラの準備がまだ整っていません。少し待ってから撮影してください。");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      onValidationError("ブラウザで画像を生成できませんでした。");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) {
      onValidationError("撮影画像を生成できませんでした。");
      return;
    }

    const file = new File([blob], `${slotLabel}.png`, { type: "image/png" });
    const validationError = validateImageFile(file);
    if (validationError) {
      onValidationError(validationError);
      return;
    }
    onSelect(file, "camera");
  }

  return (
    <div className="space-y-3">
      {devices.length > 0 ? (
        <label className="grid max-w-[28rem] gap-1 text-xs font-semibold text-[var(--color-text-secondary)]">
          カメラ
          <select
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || active || starting}
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">ブラウザの既定カメラ</option>
            {devices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {device.label || `カメラ ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="max-w-[44rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--momo-night-900)]">
        <video
          ref={videoRef}
          className="aspect-video max-h-[22rem] w-full object-contain"
          muted
          playsInline
          aria-label={`${slotLabel}のカメラプレビュー`}
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={startCamera} disabled={disabled || starting || active}>
          {starting ? "起動中…" : active ? "カメラ使用中" : "カメラ開始"}
        </Button>
        <Button onClick={capture} disabled={disabled || !active}>
          静止画を撮影
        </Button>
        <Button variant="secondary" onClick={stop} disabled={!active}>
          停止
        </Button>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        {disabled
          ? "3枚すべて配置済みのため、追加の撮影はできません。"
          : "撮影した画像は、最初の空き分類に入ります。種類が違う場合は分類を入れ替えてください。"}
      </p>
    </div>
  );
}
