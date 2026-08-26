import { Camera as CameraIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { selectableVideoDevices, stopCameraStream } from "@/features/ocrCapture/cameraCaptureMedia";
import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { SelectField } from "@/shared/ui/forms/SelectField";

type CameraCaptureProps = {
  actionVariant?: "primary" | "secondary";
  disabled?: boolean;
  renderFallback?: ((prominent: boolean) => ReactNode) | undefined;
  slotLabel: string;
  onSelect: (file: File, source: InputSource) => void;
  onValidationError: (message: string) => void;
};

export function CameraCapture({
  actionVariant = "primary",
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
    stopCameraStream(streamRef.current);
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
        setDevices(selectableVideoDevices(items));
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
      stopCameraStream(streamRef.current);
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
      stopCameraStream(streamRef.current);
      streamRef.current = null;

      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      streamRef.current = nextStream;
      if (navigator.mediaDevices.enumerateDevices) {
        try {
          const items = await navigator.mediaDevices.enumerateDevices();
          setDevices(selectableVideoDevices(items));
        } catch {
          setDevices([]);
        }
      }

      const video = videoRef.current;
      if (!video) {
        stopCameraStream(nextStream);
        streamRef.current = null;
        return;
      }

      video.srcObject = nextStream;
      try {
        await video.play();
      } catch (playError) {
        if (!nextStream.active) {
          throw playError;
        }
      }
      setActive(true);
      setError(null);
    } catch (caught) {
      stopCameraStream(streamRef.current);
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

  const useSecondaryActions = actionVariant === "secondary";
  const startVariant = useSecondaryActions || active || error !== null ? "secondary" : "primary";
  const captureVariant = useSecondaryActions || !active ? "secondary" : "primary";

  return (
    <div className="space-y-3">
      {devices.length > 0 ? (
        <SelectField
          disabled={disabled || active || starting}
          fieldClassName="max-w-[28rem]"
          label="カメラ"
          options={[
            { label: "ブラウザの既定カメラ", value: "" },
            ...devices.map((device, index) => ({
              label: device.label || `カメラ ${index + 1}`,
              value: device.deviceId,
            })),
          ]}
          value={deviceId}
          onChange={(event) => setDeviceId(event.currentTarget.value)}
        />
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
          {renderFallback?.(!useSecondaryActions)}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          pending={starting}
          pendingLabel="起動中…"
          variant={startVariant}
          onClick={startCamera}
          disabled={disabled || active}
        >
          {active ? "カメラ使用中" : "カメラ開始"}
        </Button>
        <Button
          pending={capturing}
          pendingLabel="撮影中…"
          variant={captureVariant}
          onClick={capture}
          disabled={disabled || !active}
        >
          静止画を撮影
        </Button>
        <Button variant="quiet" onClick={stop} disabled={!active || capturing}>
          停止
        </Button>
      </div>
      {disabled ? (
        <p className="text-xs text-[var(--color-text-secondary)]">現在は撮影できません。</p>
      ) : null}
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
