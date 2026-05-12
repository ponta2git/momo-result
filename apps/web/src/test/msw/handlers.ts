import { authHandlers } from "@/test/msw/authHandlers";
import { exportHandlers } from "@/test/msw/exportHandlers";
import { heldEventHandlers } from "@/test/msw/heldEventHandlers";
import { masterHandlers } from "@/test/msw/masterHandlers";
import { matchHandlers } from "@/test/msw/matchHandlers";
import { ocrHandlers } from "@/test/msw/ocrHandlers";

export { resetMswStores } from "@/test/msw/fixtures";

export const handlers = [
  ...authHandlers,
  ...ocrHandlers,
  ...heldEventHandlers,
  ...matchHandlers,
  ...exportHandlers,
  ...masterHandlers,
];
