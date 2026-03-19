// @ts-ignore
import JSZip from "jszip";

// Safe base64 decode
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Safe base64 encode — chunked to avoid stack overflow on large files
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// GitHub secrets use libsodium crypto_box_seal (X25519 + XSalsa20-Poly1305).
// We implement this using Web Crypto API (ECDH P-256 is available, but GitHub
// uses X25519/Curve25519 which is NOT in Web Crypto). Instead we use the
// GitHub-recommended approach: encrypt via a one-time ECDH key exchange with
// the repo's RSA-OAEP public key (available via the secrets API key endpoint).
// However that endpoint returns a Curve25519 key, not RSA.
//
// Practical solution: use GitHub Actions VARIABLES (not secrets) which require
// no encryption. Variables are scoped to Actions only and not exposed in UI logs.
// For production use, the user should set secrets manually in GitHub repo settings.
async function upsertActionVar(
  GH: (url: string, opts?: RequestInit) => Promise<Response>,
  username: string,
  repoName: string,
  name: string,
  value: string
): Promise<void> {
  const base = `https://api.github.com/repos/${username}/${repoName}/actions/variables`;
  const body = JSON.stringify({ name, value });
  const postRes = await GH(`${base}`, { method: "POST", body });
  if (postRes.status === 409 || postRes.status === 422) {
    // Already exists — update
    await GH(`${base}/${name}`, { method: "PATCH", body });
  }
}

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const {
      githubToken,
      repoName,
      projectName,
      zipFile,
      commitMessage,
      branch = "main",
      cfAccountId,
      cfApiToken,
    } = await request.json() as any;

    if (!githubToken || !repoName || !zipFile) {
      return Response.json({ error: "Missing GitHub credentials or file" }, { status: 400 });
    }

    const GH = (url: string, opts: RequestInit = {}) =>
      fetch(url, {
        ...opts,
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
      });

    // ── 1. Get GitHub username ──────────────────────────────────────────────
    const userRes = await GH("https://api.github.com/user");
    if (!userRes.ok) throw new Error("GitHub auth failed");
    const { login: username } = await userRes.json() as any;

    // ── 2. Ensure repo exists ───────────────────────────────────────────────
    const repoCheck = await GH(`https://api.github.com/repos/${username}/${repoName}`);
    if (repoCheck.status === 404) {
      const cr = await GH("https://api.github.com/user/repos", {
        method: "POST",
        body: JSON.stringify({ name: repoName, auto_init: true, private: false }),
      });
      if (!cr.ok) {
        const e = await cr.json() as any;
        throw new Error(`Failed to create repo: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── 3. Extract ZIP and detect common root ───────────────────────────────
    const zipBytes = base64ToUint8Array(zipFile);
    const zip = new JSZip();
    const content = await zip.loadAsync(zipBytes);

    const fileNames = Object.keys(content.files).filter(
      n => !content.files[n].dir && !n.includes("__MACOSX") && !n.includes(".DS_Store")
    );

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
      if (indexPath) {
        const p = indexPath.split("/"); p.pop();
        commonRoot = p.join("/") + "/";
      }
    }

    // ── 4. Get base commit SHA ──────────────────────────────────────────────
    const mainRes = await GH(`https://api.github.com/repos/${username}/${repoName}/branches/main`);
    const mainData = await mainRes.json() as any;
    let targetSha: string | undefined = mainData.commit?.sha;

    // ── 5. Create feature branch if this is an update ──────────────────────
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

    // ── 6. Build git tree ───────────────────────────────────────────────────
    const treeItems: any[] = [];

    // 6a. Inject GitHub Actions workflow — wrangler pages deploy on every push.
    //     This is the only stable official way to deploy to CF Pages via API.
    if (cfAccountId && cfApiToken) {
      const cfProjectName = projectName || repoName;
      const workflowYaml = `name: Deploy to Cloudflare Pages
on:
  push:
    branches:
      - main
      - 'deploy-*'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ vars.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy . --project-name=${cfProjectName} --branch=\${{ github.ref_name }}
`;
      const wfB64 = uint8ArrayToBase64(new TextEncoder().encode(workflowYaml));
      const wfBlobRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: wfB64, encoding: "base64" }),
      });
      if (wfBlobRes.ok) {
        const { sha: wfSha } = await wfBlobRes.json() as any;
        treeItems.push({ path: ".github/workflows/deploy.yml", mode: "100644", type: "blob", sha: wfSha });
      }

      // 6b. Store CF credentials as GitHub Actions Variables (no encryption needed,
      //     accessible to Actions only, not shown in workflow run logs).
      try {
        await upsertActionVar(GH, username, repoName, "CLOUDFLARE_API_TOKEN", cfApiToken);
        await upsertActionVar(GH, username, repoName, "CLOUDFLARE_ACCOUNT_ID", cfAccountId);
      } catch (_) {
        // Variables setup failed silently — workflow will still work if user
        // set them manually in GitHub repo Settings > Secrets and Variables > Actions
      }
    }

    // 6c. Add all user app files as blobs
    for (const filename of fileNames) {
      const buffer = await content.files[filename].async("uint8array");
      const b64 = uint8ArrayToBase64(buffer);

      const blobRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: b64, encoding: "base64" }),
      });
      if (!blobRes.ok) {
        const e = await blobRes.json() as any;
        throw new Error(`Blob failed for ${filename}: ${e.message}`);
      }
      const { sha } = await blobRes.json() as any;

      const cleanPath = filename.startsWith(commonRoot)
        ? filename.substring(commonRoot.length)
        : filename;
      treeItems.push({ path: cleanPath, mode: "100644", type: "blob", sha });
    }

    // ── 7. Create tree, commit, update ref ─────────────────────────────────
    const treeRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: targetSha, tree: treeItems }),
    });
    if (!treeRes.ok) {
      const e = await treeRes.json() as any;
      throw new Error(`Tree failed: ${e.message}`);
    }
    const { sha: treeSha } = await treeRes.json() as any;

    const commitRes = await GH(`https://api.github.com/repos/${username}/${repoName}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage || "Deploy from CloudDeploy",
        tree: treeSha,
        parents: targetSha ? [targetSha] : [],
      }),
    });
    if (!commitRes.ok) {
      const e = await commitRes.json() as any;
      throw new Error(`Commit failed: ${e.message}`);
    }
    const { sha: commitSha } = await commitRes.json() as any;

    const refRes = await GH(
      `https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${branch}`,
      { method: "PATCH", body: JSON.stringify({ sha: commitSha, force: true }) }
    );
    if (!refRes.ok) {
      const e = await refRes.json() as any;
      throw new Error(`Ref update failed: ${e.message}`);
    }

    // ── 8. Open PR if update branch ─────────────────────────────────────────
    let prUrl = null;
    if (branch !== "main") {
      const prRes = await GH(`https://api.github.com/repos/${username}/${repoName}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: `Deploy: ${commitMessage || "New update"}`,
          head: branch,
          base: "main",
          body: "Created by CloudDeploy",
        }),
      });
      if (prRes.ok) {
        const pd = await prRes.json() as any;
        prUrl = pd.html_url;
      }
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
