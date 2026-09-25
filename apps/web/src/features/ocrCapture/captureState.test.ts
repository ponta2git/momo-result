// @vitest-environment node
import { describe, expect, it } from "vitest";

import { validateImageFile } from "@/features/ocrCapture/captureState";

describe("validateImageFile", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])(
    "accepts %s at the 3 MB size boundary",
    (type) => {
      const file = new File([new Uint8Array(3 * 1024 * 1024)], "image", { type });
      expect(validateImageFile(file)).toBeUndefined();
    },
  );

  it("rejects one byte above the limit and explains the supported size", () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024 + 1)], "image.png", {
      type: "image/png",
    });
    expect(validateImageFile(file)).toBe("画像サイズは3MB以下にしてください。");
  });

  it("rejects a PNG filename whose actual MIME type is unsupported", () => {
    const file = new File(["image"], "misleading.png", { type: "image/gif" });
    expect(validateImageFile(file)).toBe("PNG・JPEG・WebPの画像を選択してください。");
  });
});
