import { useCallback, useEffect, useRef, useState } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";
import { Button } from "@/shared/ui/actions/Button";

type CameraCaptureProps = {
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

export function CameraCapture({ slotLabel, onSelect, onValidationError }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
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
        video: true,
        audio: false,
      });
      streamRef.current = nextStream;

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
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--momo-night-900)]">
        <video
          ref={videoRef}
          className="aspect-video w-full object-cover"
          muted
          playsInline
          aria-label={`${slotLabel}のカメラプレビュー`}
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={startCamera} disabled={starting || active}>
          {starting ? "起動中…" : active ? "カメラ使用中" : "カメラ開始"}
        </Button>
        <Button onClick={capture} disabled={!active}>
          静止画を撮影
        </Button>
        <Button variant="secondary" onClick={stop} disabled={!active}>
          停止
        </Button>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        撮影した画像は、空いている分類トレイへ左から順に入ります。
      </p>
    </div>
  );
}
