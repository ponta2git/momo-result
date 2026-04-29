import { setupServer } from "msw/node";
import { handlers } from "@/shared/api/msw/handlers";

export const server = setupServer(...handlers);
