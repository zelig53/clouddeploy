// @ts-ignore
import JSZip from "jszip";

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const MIME: Record<string, string> = {
  html: "text/html", css: "text/css", js: "application/javascript",
  mjs: "application/javascript", json: "application/json", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", ico: "image/x-icon", woff: "font/woff",
  woff2: "font/woff2", ttf: "font/ttf", webp: "image/webp",
  txt: "text/plain", webmanifest: "application/manifest+json",
  map: "application/json",
};
const guessMime = (name: string) =>
  MIME[name.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const { cfToken, cfAccountId, projectName, zipFile, branch = "main" } =
      await request.json() as any;

    if (!cfToken || !cfAccountId || !projectName || !zipFile) {
      return Response.json({ error: "Missing parameters" }, { status: 400 });
    }

    const CF = (path: string, opts: RequestInit = {}) =>
      fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${cfToken}`,
          ...(opts.headers || {}),
        },
      });

    // 1. Ensure project exists
    const projCheck = await CF(`/accounts/${cfAccountId}/pages/projects/${projectName}`);
    if (projCheck.status === 404) {
      const cr = await CF(`/accounts/${cfAccountId}/pages/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, production_branch: "main" }),
      });
      if (!cr.ok) {
        const e = await cr.json() as any;
        throw new Error(`יצירת פרויקט נכשלה: ${e.errors?.[0]?.message}`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // 2. Extract ZIP and detect common root
    const zipBytes = base64ToUint8Array(zipFile);
    const zip = new JSZip();
    const content = await zip.loadAsync(zipBytes);

    const allNames = Object.keys(content.files).filter(
      n => !content.files[n].dir && !n.includes("__MACOSX") && !n.includes(".DS_Store")
    );

    // Detect common root prefix
    let commonRoot = "";
    if (allNames.length > 0) {
      const allParts = allNames.map(n => n.split("/"));
      const minLen = Math.min(...allParts.map(p => p.length));
      const common: string[] = [];
      for (let i = 0; i < minLen - 1; i++) {
        const part = allParts[0][i];
        if (allParts.every(p => p[i] === part)) common.push(part); else break;
      }
      if (common.length > 0) commonRoot = common.join("/") + "/";
    }

    // If index.html not at root after stripping, find its folder
    const hasIndexAtRoot = allNames.find(n => n.substring(commonRoot.length) === "index.html");
    if (!hasIndexAtRoot) {
      const indexPath = allNames.find(n => n.endsWith("/index.html"));
      if (indexPath) {
        const p = indexPath.split("/"); p.pop();
        commonRoot = p.join("/") + "/";
      }
    }

    // Build file map: cleanPath -> Uint8Array
    const fileBuffers: Record<string, Uint8Array> = {};
    for (const filename of allNames) {
      let cleanPath = filename.startsWith(commonRoot)
        ? filename.substring(commonRoot.length)
        : filename;
      cleanPath = cleanPath.replace(/^\/+/, "");
      if (cleanPath) {
        fileBuffers[cleanPath] = await content.files[filename].async("uint8array");
      }
    }

    if (!fileBuffers["index.html"]) {
      const found = Object.keys(fileBuffers).slice(0, 8).join(", ");
      throw new Error(`index.html לא נמצא. קבצים שנמצאו: ${found}`);
    }

    // 3. Build SHA-256 manifest (hex)
    const manifest: Record<string, string> = {};
    for (const [filePath, buf] of Object.entries(fileBuffers)) {
      const hash = await crypto.subtle.digest("SHA-256", buf.buffer as ArrayBuffer);
      manifest["/" + filePath] = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // 4. POST manifest → Cloudflare tells us which files it needs
    const uploadTokenRes = await CF(
      `/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, manifest }),
      }
    );

    const uploadTokenData = await uploadTokenRes.json() as any;

    // If CF returns a deployment directly (no missing files needed), we're done
    if (uploadTokenRes.ok && uploadTokenData.result?.id && !uploadTokenData.result?.missing_file_hashes?.length) {
      return Response.json({
        success: true,
        deploymentUrl: uploadTokenData.result?.url || `https://${projectName}.pages.dev`,
        deploymentId: uploadTokenData.result?.id,
      });
    }

    // 5. Upload missing files via multipart
    const missingHashes: string[] = uploadTokenData.result?.missing_file_hashes || [];
    const deploymentId: string = uploadTokenData.result?.id;
    const uploadToken: string = uploadTokenData.result?.jwt;

    if (missingHashes.length > 0 && uploadToken) {
      // Build reverse map: hash -> [filePath, buf]
      const hashToFile: Record<string, [string, Uint8Array]> = {};
      for (const [filePath, buf] of Object.entries(fileBuffers)) {
        const hash = manifest["/" + filePath];
        if (hash) hashToFile[hash] = [filePath, buf];
      }

      const formData = new FormData();
      for (const hash of missingHashes) {
        const entry = hashToFile[hash];
        if (entry) {
          const [filePath, buf] = entry;
          formData.append(
            hash,
            new Blob([buf], { type: guessMime(filePath) }),
            filePath
          );
        }
      }

      const filesRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments/${deploymentId}/files`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cfToken}`, "cf-pages-upload-jwt": uploadToken },
          body: formData,
        }
      );

      if (!filesRes.ok) {
        const e = await filesRes.json() as any;
        throw new Error(`העלאת קבצים נכשלה: ${e.errors?.[0]?.message || JSON.stringify(e)}`);
      }

      // 6. Finalize deployment
      const finalRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments/${deploymentId}/finalize`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cfToken}`, "cf-pages-upload-jwt": uploadToken },
        }
      );

      if (!finalRes.ok) {
        const e = await finalRes.json() as any;
        throw new Error(`סיום פריסה נכשל: ${e.errors?.[0]?.message || JSON.stringify(e)}`);
      }
    }

    return Response.json({
      success: true,
      deploymentUrl: `https://${projectName}.pages.dev`,
      deploymentId,
    });

  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
