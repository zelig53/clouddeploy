// @ts-ignore
import JSZip from "jszip";

function hexSHA256(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buffer).then(hash =>
    Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
  );
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    html: "text/html", css: "text/css", js: "application/javascript",
    json: "application/json", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml",
    ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
    ttf: "font/ttf", webp: "image/webp", txt: "text/plain",
    xml: "application/xml", webmanifest: "application/manifest+json",
  };
  return map[ext] || "application/octet-stream";
}

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const body = await request.json() as any;
    const { projectName, accountId, apiToken, zipFile } = body;

    if (!projectName || !accountId || !apiToken || !zipFile) {
      return Response.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Extract ZIP
    const zipBytes = base64ToUint8Array(zipFile);
    const zip = new JSZip();
    const content = await zip.loadAsync(zipBytes);

    const fileNames = Object.keys(content.files).filter(n =>
      !content.files[n].dir && !n.includes("__MACOSX") && !n.includes(".DS_Store")
    );

    // Detect common root
    let commonRoot = "";
    if (fileNames.length > 0) {
      const allParts = fileNames.map(n => n.split("/"));
      const minLen = Math.min(...allParts.map(p => p.length));
      const common: string[] = [];
      for (let i = 0; i < minLen - 1; i++) {
        const part = allParts[0][i];
        if (allParts.every(p => p[i] === part)) common.push(part); else break;
      }
      if (common.length > 0) commonRoot = common.join("/") + "/";
    }
    const hasIndexAtRoot = fileNames.find(n => n.substring(commonRoot.length) === "index.html");
    if (!hasIndexAtRoot) {
      const indexPath = fileNames.find(n => n.endsWith("/index.html"));
      if (indexPath) { const p = indexPath.split("/"); p.pop(); commonRoot = p.join("/") + "/"; }
    }

    // Build file map
    const fileBuffers: Record<string, Uint8Array> = {};
    for (const filename of fileNames) {
      const buf = await content.files[filename].async("uint8array");
      let cleanPath = filename.startsWith(commonRoot) ? filename.substring(commonRoot.length) : filename;
      cleanPath = cleanPath.replace(/^\/+/, "");
      if (cleanPath) fileBuffers[cleanPath] = buf;
    }

    if (!fileBuffers["index.html"]) {
      const keys = Object.keys(fileBuffers).slice(0, 8).join(", ");
      return Response.json({ error: `index.html not found. Files: ${keys}` }, { status: 400 });
    }

    // Ensure CF project exists
    const CF = (path: string, opts: RequestInit = {}) =>
      fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${apiToken}`, ...(opts.headers || {}) },
      });

    const projectCheck = await CF(`/pages/projects/${projectName}`);
    if (projectCheck.status === 404) {
      const cr = await CF("/pages/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, production_branch: "main" }),
      });
      if (!cr.ok) {
        const e = await cr.json() as any;
        throw new Error(`Failed to create project: ${e.errors?.[0]?.message}`);
      }
    }

    // Build manifest with SHA256
    const manifest: Record<string, string> = {};
    for (const [filePath, buf] of Object.entries(fileBuffers)) {
      manifest["/" + filePath] = await hexSHA256(buf.buffer as ArrayBuffer);
    }

    // Upload to CF Pages
    const formData = new FormData();
    formData.append("manifest", JSON.stringify(manifest));
    formData.append("metadata", JSON.stringify({ branch: "main" }));
    for (const [filePath, buf] of Object.entries(fileBuffers)) {
      const blob = new Blob([buf], { type: guessMime(filePath) });
      formData.append(filePath, blob, filePath);
    }

    const deployRes = await CF(`/pages/projects/${projectName}/deployments`, {
      method: "POST",
      body: formData,
    });

    const deployData = await deployRes.json() as any;
    if (!deployRes.ok) {
      throw new Error(`Cloudflare deploy error: ${deployData.errors?.[0]?.message || "Unknown"}`);
    }

    return Response.json({
      success: true,
      url: `https://${projectName}.pages.dev`,
      previewUrl: deployData.result?.url,
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
