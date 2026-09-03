import { Camera as CameraIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import { useCameraCaptureSession } from "@/features/ocrCapture/useCameraCaptureSession";
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
  const camera = useCameraCaptureSession({ disabled, onSelect, onValidationError, slotLabel });
  const useSecondaryActions = actionVariant === "secondary";
  const startVariant =
    useSecondaryActions || camera.active || camera.error !== null ? "secondary" : "primary";
  const captureVariant = useSecondaryActions || !camera.active ? "secondary" : "primary";

  return (
    <div className="space-y-3">
      {camera.devices.length > 0 ? (
        <div className="max-w-[28rem]">
          <SelectField
            disabled={disabled || camera.active || camera.starting}
            label="カメラ"
            options={[
              { label: "ブラウザの既定カメラ", value: "" },
              ...camera.devices.map((device, index) => ({
                label: device.label || `カメラ ${index + 1}`,
                value: device.deviceId,
              })),
            ]}
            value={camera.deviceId}
            onChange={(event) => camera.selectDevice(event.currentTarget.value)}
          />
        </div>
      ) : null}
      <div
        aria-label={`${slotLabel}の16:9カメラ画像枠`}
        className="relative aspect-video w-full overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-media-canvas)]"
        role="group"
      >
        {camera.active ? null : (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-[var(--color-text-inverse)]/75">
            <div>
              <CameraIcon aria-hidden="true" className="mx-auto size-7" />
              <p className="mt-2 text-sm font-semibold">カメラを開始して画面を撮影</p>
            </div>
          </div>
        )}
        <video
          ref={camera.videoRef}
          className="size-full object-contain"
          muted
          playsInline
          aria-label={`${slotLabel}のカメラプレビュー`}
        />
        <canvas ref={camera.canvasRef} className="hidden" />
      </div>
      {camera.error ? (
        <div
          className="grid gap-3 rounded-sm border border-[var(--color-danger)]/45 bg-[var(--color-danger)]/8 p-3"
          role="alert"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              カメラを利用できません
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{camera.error}</p>
          </div>
          {renderFallback?.(!useSecondaryActions)}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          pending={camera.starting}
          pendingLabel="起動中…"
          variant={startVariant}
          onClick={camera.startCamera}
          disabled={disabled || camera.active}
        >
          {camera.active ? "カメラ使用中" : "カメラ開始"}
        </Button>
        <Button
          pending={camera.capturing}
          pendingLabel="撮影中…"
          variant={captureVariant}
          onClick={camera.capture}
          disabled={disabled || !camera.active}
        >
          静止画を撮影
        </Button>
        <Button variant="quiet" onClick={camera.stop} disabled={!camera.active || camera.capturing}>
          停止
        </Button>
      </div>
      {disabled ? (
        <p className="text-xs text-[var(--color-text-secondary)]">現在は撮影できません。</p>
      ) : null}
      {!camera.error && renderFallback ? (
        <div className="grid w-full text-sm text-[var(--color-text-secondary)] sm:w-fit">
          <Disclosure
            keepMounted
            panelPadding="xs"
            panelSpacing="sm"
            presentation="inset"
            summary="カメラが使えない場合"
          >
            {renderFallback(false)}
          </Disclosure>
        </div>
      ) : null}
    </div>
  );
}
