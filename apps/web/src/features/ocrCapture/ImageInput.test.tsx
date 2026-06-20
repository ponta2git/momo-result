import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImageInput } from "@/features/ocrCapture/ImageInput";

describe("ImageInput", () => {
  it("clears the file input after a successful selection so the same file can be selected again", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<ImageInput slotLabel="OCR" onSelect={onSelect} onValidationError={() => undefined} />);

    const input = screen.getByLabelText("OCRの画像をアップロード");
    const file = new File(["image"], "same.png", { type: "image/png" });

    await user.upload(input, file);
    expect(input).toHaveValue("");

    await user.upload(input, file);

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, file, "upload");
    expect(onSelect).toHaveBeenNthCalledWith(2, file, "upload");
  });
});
