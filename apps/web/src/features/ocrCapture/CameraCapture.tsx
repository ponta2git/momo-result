import { Camera as CameraIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";

type CameraCaptureProps = {
  disabled?: boolean;
  renderFallback?: ((prominent: boolean) => ReactNode) | undefined;
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
  renderFallback,
  slotLabel,
  onSelect,
  onValidationError,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const capturingRef = useRef(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.srcObject) {
        video.pause();
      }
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
      try {
        const items = await navigator.mediaDevices.enumerateDevices();
        setDevices(items.filter((item) => item.kind === "videoinput"));
      } catch {
        setDevices([]);
      }
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
      setError("このブラウザではカメラ撮影を利用できません。");
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
        try {
          const items = await navigator.mediaDevices.enumerateDevices();
          setDevices(items.filter((item) => item.kind === "videoinput"));
        } catch {
          setDevices([]);
        }
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
      setError(
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "カメラの利用が許可されていません。ブラウザの権限を確認してください。"
          : "カメラを開始できませんでした。接続とブラウザの権限を確認してください。",
      );
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function capture() {
    if (capturingRef.current) {
      return;
    }
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

    capturingRef.current = true;
    setCapturing(true);
    try {
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
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
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
      <div className="relative max-w-[44rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--momo-night-900)]">
        {active ? null : (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-white/75">
            <div>
              <CameraIcon aria-hidden="true" className="mx-auto size-7" />
              <p className="mt-2 text-sm font-semibold">カメラを開始して画面を撮影</p>
            </div>
          </div>
        )}
        <video
          ref={videoRef}
          className="aspect-video max-h-[22rem] w-full object-contain"
          muted
          playsInline
          aria-label={`${slotLabel}のカメラプレビュー`}
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>
      {error ? (
        <div
          className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/8 p-3"
          role="alert"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              カメラを利用できません
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{error}</p>
          </div>
          {renderFallback?.(true)}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          pending={starting}
          pendingLabel="起動中…"
          onClick={startCamera}
          disabled={disabled || active}
        >
          {active ? "カメラ使用中" : "カメラ開始"}
        </Button>
        <Button
          pending={capturing}
          pendingLabel="撮影中…"
          onClick={capture}
          disabled={disabled || !active}
        >
          静止画を撮影
        </Button>
        <Button variant="quiet" onClick={stop} disabled={!active || capturing}>
          停止
        </Button>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        {disabled ? "現在は撮影できません。" : `撮影すると「${slotLabel}」へ配置します。`}
      </p>
      {!error && renderFallback ? (
        <Disclosure
          className="w-full text-sm text-[var(--color-text-secondary)] sm:w-fit"
          keepMounted
          panelClassName="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2"
          summary="カメラが使えない場合"
          triggerClassName="w-full sm:w-auto"
        >
          {renderFallback(false)}
        </Disclosure>
      ) : null}
    </div>
  );
}
