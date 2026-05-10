import { useEffect, useRef } from "react";

import type { InputSource } from "@/features/ocrCapture/captureState";
import { validateImageFile } from "@/features/ocrCapture/captureState";
import { Button } from "@/shared/ui/actions/Button";

type ImageInputProps = {
  disabled?: boolean;
  slotLabel: string;
  onSelect: (file: File, source: InputSource) => void;
  onValidationError: (message: string) => void;
};

export function ImageInput({
  disabled = false,
  slotLabel,
  onSelect,
  onValidationError,
}: ImageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    return () => {
      if (input) {
        input.value = "";
      }
    };
  }, []);

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={inputRef}
        aria-label={`${slotLabel}の画像をアップロード`}
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
          onSelect(file, "upload");
        }}
      />
      <Button disabled={disabled} variant="secondary" onClick={() => inputRef.current?.click()}>
        単体画像を追加
      </Button>
    </div>
  );
}
