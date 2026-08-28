import { useRef } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";
import { Button } from "@/shared/ui/actions/Button";

type ImageInputProps = {
  disabled?: boolean;
  prominent?: boolean;
  slotLabel: string;
  onSelect: (file: File, source: InputSource) => void;
  onValidationError: (message: string) => void;
};

export function ImageInput({
  disabled = false,
  prominent = false,
  slotLabel,
  onSelect,
  onValidationError,
}: ImageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={inputRef}
        aria-label="OCRの画像をアップロード"
        className="sr-only"
        disabled={disabled}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) {
            return;
          }
          const error = validateImageFile(file);
          if (error) {
            onValidationError(error);
            event.currentTarget.value = "";
            return;
          }
          try {
            onSelect(file, "upload");
          } finally {
            event.currentTarget.value = "";
          }
        }}
      />
      <Button
        disabled={disabled}
        title={`${slotLabel}へ画像ファイルを追加`}
        variant={prominent ? "secondary" : "quiet"}
        onClick={() => inputRef.current?.click()}
      >
        ファイルから追加
      </Button>
    </div>
  );
}
