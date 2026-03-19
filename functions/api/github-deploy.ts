// @ts-ignore
import JSZip from "jszip";

// Safe base64 decode — handles large files without stack overflow
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Safe base64 encode — processes in chunks to avoid stack overflow
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const { githubToken, repoName, projectName, zipFile, commitMessage, branch = "main" } = await request.json() as any;
    if (!githubToken || !repoName || !zipFile) {
      return Response.json({ error: "Missing GitHub credentials or file" }, { status: 400 });
    }

    const GH = (url: string, opts: RequestInit = {}) =>
      fetch(url, {
        ...opts,
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
      });

    // Get username
    const userRes = await GH("https://api.github.com/user");
    if (!userRes.ok) throw new Error("GitHub auth failed");
    const { login: username } = await userRes.json() as any;

    // Ensure repo exists
    const repoCheck = await GH(`https://api.github.com/repos/${username}/${repoName}`);
    if (repoCheck.status === 404) {
      const cr = await GH("https://api.github.com/user/repos", {
        method: "POST",
        body: JSON.stringify({ name: repoName, auto_init: true }),
      });
      if (!cr.ok) { const e = await cr.json() as any; throw new Error(`Failed to create repo: ${e.message}`); }
      await new Promise(r => setTimeout(r, 2000));
    }

    // Extract ZIP
    const zipBytes = base64ToUint8Array(zipFile);
    const zip = new JSZip();
    const content = await zip.loadAsync(zipBytes);
    const fileNames = Object.keys(content.files).filter(
      n => !content.files[n].dir && !n.includes("__MACOSX") && !n.includes(".DS_Store")
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

    // Get base SHA
    const mainRes = await GH(`https://api.github.com/repos/${username}/${repoName}/branches/main`);
    const mainData = await mainRes.json() as any;
    let targetSha = mainData.commit?.sha;

    // Create branch if update
    if (branch !== "main" && targetSha) {
      const branchCheck = await GH(`https://api.github.com/repos/${username}/${repoName}/branches/${branch}`);
      if (branchCheck.status === 404) {
        await GH(`https://api.github.com/repos/${username}/${repoName}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: targetSha }),
        });
      } else {
        const bd = await branchCheck.json() as any;
        targetSha = bd.commit?.sha;
      }
    }

    // Create blobs — using chunked base64 to avoid stack overflow
    const treeItems: any[] = [];
    for (const filename of fileNames) {
      const buffer = await content.files[filename].async("uint8array");
      const b64 = uint8ArrayToBase64(buffer); // safe chunked encoding

      const blobRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: b64, encoding: "base64" }),
      });
      if (!blobRes.ok) { const e = await blobRes.json() as any; throw new Error(`Blob failed for ${filename}: ${e.message}`); }
      const { sha } = await blobRes.json() as any;

      let cleanPath = filename.startsWith(commonRoot) ? filename.substring(commonRoot.length) : filename;
      treeItems.push({ path: cleanPath, mode: "100644", type: "blob", sha });
    }

    // Create tree
    const treeRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: targetSha, tree: treeItems }),
    });
    if (!treeRes.ok) { const e = await treeRes.json() as any; throw new Error(`Tree failed: ${e.message}`); }
    const { sha: treeSha } = await treeRes.json() as any;

    // Create commit
    const commitRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: commitMessage || "Deploy from CloudDeploy", tree: treeSha, parents: targetSha ? [targetSha] : [] }),
    });
    if (!commitRes.ok) { const e = await commitRes.json() as any; throw new Error(`Commit failed: ${e.message}`); }
    const { sha: commitSha } = await commitRes.json() as any;

    // Update ref
    const refRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: true }),
    });
    if (!refRes.ok) { const e = await refRes.json() as any; throw new Error(`Ref update failed: ${e.message}`); }

    // PR if not main
    let prUrl = null;
    if (branch !== "main") {
      const prRes = await GH(`https://api.github.com/repos/${username}/${repoName}/pulls`, {
        method: "POST",
        body: JSON.stringify({ title: `Deploy: ${commitMessage || "New update"}`, head: branch, base: "main", body: "Created by CloudDeploy" }),
      });
      if (prRes.ok) { const pd = await prRes.json() as any; prUrl = pd.html_url; }
    }

    return Response.json({
      success: true,
      repoUrl: `https://github.com/${username}/${repoName}`,
      prUrl,
      cloudflareUrl: `https://${projectName || repoName}.pages.dev`,
      branch,
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
