import { serveStatic, type AssetBinding } from "./assets.ts";
import { proxy, type ProxyEnvironment } from "./proxy.ts";
import { failure } from "./response.ts";

interface Environment extends ProxyEnvironment {
  ASSETS: AssetBinding;
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return failure(400);
    }
    if (
      /(?:^|\/)\./u.test(path) ||
      path === "/openapi.yaml" ||
      /^\/(?:api\/)?__momo_runtime(?:\/|$)/u.test(path)
    )
      return failure(404);
    if (
      path === "/api" ||
      path.startsWith("/api/") ||
      path === "/healthz" ||
      path === "/healthz/details"
    )
      return proxy(request, env, url, path);
    return serveStatic(request, env.ASSETS, url, path);
  },
};
