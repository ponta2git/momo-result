import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { selectableVideoDevices, stopCameraStream } from "@/features/ocrCapture/cameraCaptureMedia";
import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";

type CameraCaptureSessionOptions = {
  disabled: boolean;
  onSelect: (file: File, source: InputSource) => void;
  onValidationError: (message: string) => void;
  slotLabel: string;
};

function isMediaStream(value: unknown): value is MediaStream {
  return Boolean(value && typeof (value as MediaStream).getTracks === "function");
}

export function useCameraCaptureSession({
  disabled,
  onSelect,
  onValidationError,
  slotLabel,
}: CameraCaptureSessionOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  const cameraGenerationRef = useRef(0);
  const deviceEnumerationGenerationRef = useRef(0);
  const stoppedStreamsRef = useRef(new WeakSet<MediaStream>());
  const startingRef = useRef(false);
  const capturingRef = useRef(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stopStreamOnce = useCallback((stream: MediaStream | null) => {
    if (!stream || stoppedStreamsRef.current.has(stream)) return;
    stoppedStreamsRef.current.add(stream);
    stopCameraStream(stream);
  }, []);

  const releaseStream = useCallback(
    (stream: MediaStream) => {
      const video = videoRef.current;
      if (video?.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
      if (streamRef.current === stream) streamRef.current = null;
      stopStreamOnce(stream);
    },
    [stopStreamOnce],
  );

  const releaseCurrentStream = useCallback(
    (pausePreview = true) => {
      const stream = streamRef.current;
      streamRef.current = null;
      const video = videoRef.current;
      if (video) {
        const previewStream = video.srcObject;
        if (previewStream && pausePreview) video.pause();
        video.srcObject = null;
        if (previewStream !== stream && isMediaStream(previewStream)) {
          stopStreamOnce(previewStream);
        }
      }
      stopStreamOnce(stream);
    },
    [stopStreamOnce],
  );

  const isCurrentCameraGeneration = useCallback(
    (generation: number) => mountedRef.current && cameraGenerationRef.current === generation,
    [],
  );

  const refreshDevices = useCallback(
    async (cameraGeneration?: number) => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const enumerationGeneration = deviceEnumerationGenerationRef.current + 1;
      deviceEnumerationGenerationRef.current = enumerationGeneration;
      const mayCommit = () =>
        mountedRef.current &&
        deviceEnumerationGenerationRef.current === enumerationGeneration &&
        (cameraGeneration === undefined || isCurrentCameraGeneration(cameraGeneration));

      try {
        const items = await navigator.mediaDevices.enumerateDevices();
        if (mayCommit()) setDevices(selectableVideoDevices(items));
      } catch {
        if (mayCommit()) setDevices([]);
      }
    },
    [isCurrentCameraGeneration],
  );

  const stop = useCallback(() => {
    cameraGenerationRef.current += 1;
    startingRef.current = false;
    capturingRef.current = false;
    releaseCurrentStream();
    if (mountedRef.current) {
      setActive(false);
      setStarting(false);
      setCapturing(false);
    }
  }, [releaseCurrentStream]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cameraGenerationRef.current += 1;
      deviceEnumerationGenerationRef.current += 1;
      startingRef.current = false;
      capturingRef.current = false;
      releaseCurrentStream(false);
    };
  }, [releaseCurrentStream]);

  useEffect(() => {
    // Device state arrives asynchronously from enumerateDevices, not from render-derived data.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshDevices();
  }, [refreshDevices]);

  useLayoutEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  async function startCamera() {
    if (disabled || startingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("このブラウザではカメラ撮影を利用できません。");
      return;
    }

    startingRef.current = true;
    setStarting(true);
    const cameraGeneration = cameraGenerationRef.current + 1;
    cameraGenerationRef.current = cameraGeneration;
    let nextStream: MediaStream | null = null;
    try {
      releaseCurrentStream();
      nextStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      if (!isCurrentCameraGeneration(cameraGeneration)) {
        releaseStream(nextStream);
        return;
      }

      streamRef.current = nextStream;
      await refreshDevices(cameraGeneration);
      if (!isCurrentCameraGeneration(cameraGeneration)) {
        releaseStream(nextStream);
        return;
      }

      const video = videoRef.current;
      if (!video) {
        releaseStream(nextStream);
        return;
      }
      video.srcObject = nextStream;
      try {
        await video.play();
      } catch (playError) {
        if (!nextStream.active) throw playError;
      }
      if (!isCurrentCameraGeneration(cameraGeneration)) {
        releaseStream(nextStream);
        return;
      }
      setActive(true);
      setError(null);
    } catch (caught) {
      if (!isCurrentCameraGeneration(cameraGeneration)) {
        if (nextStream) releaseStream(nextStream);
        return;
      }
      if (nextStream) releaseStream(nextStream);
      else releaseCurrentStream();
      setActive(false);
      setError(
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "カメラの利用が許可されていません。ブラウザの権限を確認してください。"
          : "カメラを開始できませんでした。接続とブラウザの権限を確認してください。",
      );
    } finally {
      if (isCurrentCameraGeneration(cameraGeneration)) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }

  async function capture() {
    if (capturingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const stream = streamRef.current;
    if (!video || !canvas || !stream) return;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      onValidationError("カメラの準備がまだ整っていません。少し待ってから撮影してください。");
      return;
    }

    capturingRef.current = true;
    setCapturing(true);
    const cameraGeneration = cameraGenerationRef.current;
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
      if (
        !isCurrentCameraGeneration(cameraGeneration) ||
        streamRef.current !== stream ||
        videoRef.current !== video
      ) {
        return;
      }
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
      if (isCurrentCameraGeneration(cameraGeneration)) {
        capturingRef.current = false;
        setCapturing(false);
      }
    }
  }

  return {
    active,
    canvasRef,
    capture,
    capturing,
    deviceId,
    devices,
    error,
    selectDevice: setDeviceId,
    startCamera,
    starting,
    stop,
    videoRef,
  };
}
