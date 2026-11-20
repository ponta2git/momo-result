import { failure } from "./response.ts";

export interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

async function lookup(request: Request, assets: AssetBinding, url: URL, path: string) {
  const spaRoute = !path.startsWith("/assets/") && !path.includes(".", path.lastIndexOf("/"));
  // With html_handling=none, a directory (including /) cannot match a file.
  // Other extensionless paths may be real files, which take precedence over the SPA.
  if (!spaRoute || !path.endsWith("/")) {
    const asset = await assets.fetch(request);
    if (!spaRoute || asset.status !== 404) return asset;
    await asset.body?.cancel();
  }
  url.pathname = "/index.html";
  return assets.fetch(new Request(url, request));
}

export async function serveStatic(request: Request, assets: AssetBinding, url: URL, path: string) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = failure(405);
    response.headers.set("Allow", "GET, HEAD");
    return response;
  }

  try {
    const asset = await lookup(request, assets, url, path);
    // Static Assets applies _headers by URL, even to redirects and errors.
    // Return the native byte stream and validators untouched on hits and revalidation.
    if (asset.ok || asset.status === 304) return asset;
    const response = new Response(asset.body, asset);
    response.headers.set("Cache-Control", asset.status >= 400 ? "no-store" : "no-cache");
    return response;
  } catch {
    return failure(503);
  }
}
