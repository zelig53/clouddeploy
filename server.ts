import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs-extra";
import dotenv from "dotenv";
import JSZip from "jszip";
import crypto from "crypto";
import mime from "mime-types";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);
dotenv.config();

async function runCommand(command: string, cwd: string) {
  console.log(`Running command: ${command} in ${cwd}`);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: 300000 });
    if (stderr) console.warn(`Command stderr: ${stderr}`);
    return stdout;
  } catch (error: any) {
    console.error(`Command failed: ${command}`, error);
    throw new Error(`Command failed: ${error.message}\n${error.stderr || ""}`);
  }
}

async function buildSource(zipBuffer: Buffer, buildCommand: string = "npm run build", outputDir: string = "dist") {
  const tempDir = path.join(os.tmpdir(), `build-${Date.now()}`);
  await fs.ensureDir(tempDir);

  try {
    const zip = new JSZip();
    const content = await zip.loadAsync(zipBuffer);
    
    for (const [filename, file] of Object.entries(content.files)) {
      if (file.dir) continue;
      const filePath = path.join(tempDir, filename);
      await fs.ensureDir(path.dirname(filePath));
      const buffer = await file.async("nodebuffer");
      await fs.writeFile(filePath, buffer);
    }

    let projectRoot = tempDir;
    const files = await fs.readdir(tempDir);
    if (files.length === 1) {
      const stats = await fs.stat(path.join(tempDir, files[0]));
      if (stats.isDirectory()) {
        projectRoot = path.join(tempDir, files[0]);
      }
    }

    if (!(await fs.pathExists(path.join(projectRoot, "package.json")))) {
      throw new Error("לא נמצא קובץ package.json. ודא שהעלית פרויקט תקין.");
    }

    console.log("Installing dependencies...");
    await runCommand("npm install --no-audit --no-fund --prefer-offline", projectRoot);
    
    console.log(`Building project with command: ${buildCommand}...`);
    await runCommand(buildCommand, projectRoot);

    const possibleDirs = [outputDir, "dist", "build", "out", ".next/out"];
    let buildDir = "";
    for (const dir of possibleDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (await fs.pathExists(fullPath)) {
        buildDir = fullPath;
        break;
      }
    }

    if (!buildDir) {
      throw new Error(`לא נמצאה תיקיית הפלט (${outputDir}). ודא שפקודת ה-build שלך תקינה.`);
    }

    const buildFiles: Record<string, Buffer> = {};
    const getFiles = async (dir: string, base: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(base, entry.name);
        if (entry.isDirectory()) {
          await getFiles(fullPath, relPath);
        } else {
          buildFiles["/" + relPath.replace(/\\/g, "/")] = await fs.readFile(fullPath);
        }
      }
    };
    await getFiles(buildDir, "");
    return buildFiles;
  } finally {
    setTimeout(() => fs.remove(tempDir).catch(console.error), 60000);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route to list Cloudflare Pages projects
  app.get("/api/projects", async (req, res) => {
    const { accountId, apiToken } = req.query;

    const cfToken = apiToken as string || process.env.CLOUDFLARE_API_TOKEN;
    const cfAccountId = accountId as string || process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!cfToken || !cfAccountId) {
      return res.status(400).json({ error: "Cloudflare credentials missing" });
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects`,
        {
          headers: { Authorization: `Bearer ${cfToken}` },
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || "Failed to fetch projects");
      }

      res.json(data.result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route for Cloudflare Deployment
  app.post("/api/deploy", async (req, res) => {
    const { projectName, zipFile, accountId, apiToken, buildOnServer, buildCommand, outputDir } = req.body;

    const cfToken = apiToken || process.env.CLOUDFLARE_API_TOKEN;
    const cfAccountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!cfToken || !cfAccountId) {
      return res.status(400).json({ error: "Cloudflare credentials missing" });
    }

    if (!zipFile) {
      return res.status(400).json({ error: "Zip file missing" });
    }

    try {
      console.log(`Starting deployment for project: ${projectName}`);
      let fileBuffers: Record<string, Buffer> = {};
      const zipBuffer = Buffer.from(zipFile, "base64");

      if (buildOnServer) {
        console.log(`Starting server-side build with command: ${buildCommand} and outputDir: ${outputDir}`);
        fileBuffers = await buildSource(zipBuffer, buildCommand, outputDir);
      } else {
        console.log("Processing ZIP file directly...");
        const zip = new JSZip();
        const content = await zip.loadAsync(zipBuffer);
        
        const fileNames = Object.keys(content.files).filter(name => {
          const isDir = content.files[name].dir;
          const isSystem = name.includes('__MACOSX') || name.includes('.DS_Store');
          return !isDir && !isSystem;
        });

        console.log(`Found ${fileNames.length} files in ZIP`);

        let commonRoot = "";
        if (fileNames.length > 0) {
          const allParts = fileNames.map(name => name.split("/"));
          const minLen = Math.min(...allParts.map(p => p.length));
          let commonParts = [];
          for (let i = 0; i < minLen - 1; i++) {
            const part = allParts[0][i];
            const allSame = allParts.every(p => p[i] === part);
            if (allSame) commonParts.push(part);
            else break;
          }
          if (commonParts.length > 0) {
            commonRoot = commonParts.join("/") + "/";
            console.log(`Detected common root: ${commonRoot}`);
          }
        }

        const relativeIndex = fileNames.find(name => 
          name.substring(commonRoot.length).replace(/^\//, "") === "index.html"
        );

        if (!relativeIndex) {
          const indexPath = fileNames.find(name => name.endsWith("/index.html"));
          if (indexPath) {
            const parts = indexPath.split("/");
            parts.pop();
            commonRoot = parts.join("/") + "/";
            console.log(`Adjusted common root to index.html location: ${commonRoot}`);
          }
        }

        for (const filename of fileNames) {
          const file = content.files[filename];
          let cleanPath = filename;
          if (commonRoot && cleanPath.startsWith(commonRoot)) {
            cleanPath = cleanPath.substring(commonRoot.length);
          }
          // Remove ALL leading slashes for Cloudflare manifest
          cleanPath = cleanPath.replace(/^\/+/, "");
          fileBuffers[cleanPath] = await file.async("nodebuffer");
        }
      }

      console.log(`Prepared ${Object.keys(fileBuffers).length} files for deployment`);

      // 1. Check if project exists, if not create it
      console.log(`Checking if project ${projectName} exists...`);
      const projectCheck = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}`,
        {
          headers: { Authorization: `Bearer ${cfToken}` },
        }
      );

      if (projectCheck.status === 404) {
        console.log(`Project ${projectName} not found. Creating it...`);
        const createRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cfToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: projectName,
              production_branch: "main",
            }),
          }
        );
        if (!createRes.ok) {
          const err = await createRes.json();
          console.error("Project Creation Failed:", err);
          throw new Error(`שגיאה ביצירת הפרויקט: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
        }
        console.log("Project created successfully");
      } else if (!projectCheck.ok) {
        const err = await projectCheck.json();
        console.error("Project Check Failed:", err);
        throw new Error(`שגיאה בבדיקת הפרויקט: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
      }

      // 2. Prepare manifest
      const manifest: Record<string, string> = {};
      for (const [path, buffer] of Object.entries(fileBuffers)) {
        // Ensure path starts with / for the manifest key (Cloudflare actually requires / for the key in some cases, but let's try without first as per docs)
        // Actually, let's stick to the docs: "The manifest is a map of the relative path of the file to its SHA-256 hash."
        // Usually it's "index.html"
        manifest["/" + path] = crypto.createHash("sha256").update(buffer).digest("hex");
      }

      if (!manifest["/index.html"]) {
        const fileList = Object.keys(manifest).slice(0, 10).join(", ");
        console.error("index.html not found. Files found:", fileList);
        const hasPackageJson = Object.keys(manifest).some(n => n.endsWith("package.json"));
        if (hasPackageJson && !buildOnServer) {
          throw new Error("נראה שהעלית את קוד המקור (Source Code) במקום את הקבצים הבנויים. אנא בחר באפשרות 'בצע Build בשרת' או העלה את תיקיית dist.");
        }
        throw new Error(`קובץ index.html לא נמצא בתיקייה הראשית של הפרויקט. קבצים שנמצאו: ${fileList}...`);
      }

      // 3. Create Deployment
      console.log("Uploading files to Cloudflare...");
      const finalFormData = new FormData();
      finalFormData.append("manifest", JSON.stringify(manifest));
      finalFormData.append("metadata", JSON.stringify({
        branch: "main"
      }));

      // Append files with correct content types
      for (const [cleanPath, buffer] of Object.entries(fileBuffers)) {
        const contentType = mime.lookup(cleanPath) || "application/octet-stream";
        const blob = new Blob([buffer], { type: contentType });
        finalFormData.append(cleanPath, blob, cleanPath);
      }

      const deployRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfToken}`,
          },
          body: finalFormData,
        }
      );

      const deployData = await deployRes.json();
      if (!deployRes.ok) {
        console.error("Cloudflare Deployment Error:", JSON.stringify(deployData));
        throw new Error(`שגיאת פריסה מ-Cloudflare: ${deployData.errors?.[0]?.message || "שגיאה לא ידועה"}`);
      }

      console.log("Deployment successful!");
      res.json({ 
        success: true, 
        url: `https://${projectName}.pages.dev`,
        previewUrl: deployData.result.url,
        message: "Deployment successful"
      });

    } catch (error: any) {
      console.error("Deployment error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to list deployments for a project
  app.get("/api/deployments", async (req, res) => {
    const { accountId, apiToken, projectName } = req.query;

    const cfToken = apiToken as string || process.env.CLOUDFLARE_API_TOKEN;
    const cfAccountId = accountId as string || process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!cfToken || !cfAccountId || !projectName) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`,
        {
          headers: { Authorization: `Bearer ${cfToken}` },
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || "Failed to fetch deployments");
      }

      res.json(data.result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to rollback to a specific deployment
  app.post("/api/rollback", async (req, res) => {
    const { accountId, apiToken, projectName, deploymentId } = req.body;

    const cfToken = apiToken || process.env.CLOUDFLARE_API_TOKEN;
    const cfAccountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!cfToken || !cfAccountId || !projectName || !deploymentId) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments/${deploymentId}/rollback`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${cfToken}` },
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || "Rollback failed");
      }

      res.json(data.result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to prepare GitHub repo (ensure it exists)
  app.post("/api/github-prepare", async (req, res) => {
    const { githubToken, repoName } = req.body;

    if (!githubToken || !repoName) {
      return res.status(400).json({ error: "Missing GitHub credentials or repo name" });
    }

    try {
      // 1. Get user info
      const userRes = await fetch("https://api.github.com/user", {
        headers: { 
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Accept": "application/json"
        }
      });
      const userData = await userRes.json().catch(() => ({}));
      const username = userData.login;
      if (!username) throw new Error("Failed to get GitHub username");

      // 2. Check if repo exists, if not create it
      console.log(`Checking if repo ${repoName} exists...`);
      let repoRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
        headers: { 
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Accept": "application/json"
        }
      });

      if (repoRes.status === 404) {
        console.log(`Creating repo ${repoName}...`);
        repoRes = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "User-Agent": "CloudDeploy-Mobile",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            name: repoName,
            description: "Deployed from CloudDeploy",
            private: false,
            auto_init: true // Create README.md and main branch
          })
        });

        if (!repoRes.ok) {
          const err = await repoRes.json();
          throw new Error(`Failed to create repository: ${err.message || JSON.stringify(err)}`);
        }
      }

      res.json({ success: true, username });
    } catch (error: any) {
      console.error("GitHub Prepare Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to test GitHub token
  app.post("/api/github-test", async (req, res) => {
    const { githubToken } = req.body;
    if (!githubToken) return res.status(400).json({ error: "Missing GitHub token" });

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile"
        }
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Invalid token");
      }

      const data = await response.json();
      res.json({ success: true, username: data.login });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  });

  // API Route for GitHub Deployment
  app.post("/api/github-deploy", async (req, res) => {
    const { githubToken, repoName, projectName, zipFile, commitMessage, branch = "main" } = req.body;

    if (!githubToken || !repoName || !zipFile) {
      return res.status(400).json({ error: "Missing GitHub credentials or file" });
    }

    try {
      console.log(`Starting GitHub deployment to: ${repoName} (Branch: ${branch})`);
      const zipBuffer = Buffer.from(zipFile, "base64");
      const zip = new JSZip();
      const content = await zip.loadAsync(zipBuffer);
      
      const fileNames = Object.keys(content.files).filter(name => {
        const isDir = content.files[name].dir;
        const isSystem = name.includes('__MACOSX') || name.includes('.DS_Store');
        return !isDir && !isSystem;
      });

      let commonRoot = "";
      if (fileNames.length > 0) {
        const allParts = fileNames.map(name => name.split("/"));
        const minLen = Math.min(...allParts.map(p => p.length));
        let commonParts = [];
        for (let i = 0; i < minLen - 1; i++) {
          const part = allParts[0][i];
          const allSame = allParts.every(p => p[i] === part);
          if (allSame) commonParts.push(part);
          else break;
        }
        if (commonParts.length > 0) commonRoot = commonParts.join("/") + "/";
      }

      // Robust index.html detection for common root
      const relativeIndex = fileNames.find(name => 
        name.substring(commonRoot.length).replace(/^\//, "") === "index.html"
      );

      if (!relativeIndex) {
        const indexPath = fileNames.find(name => name.endsWith("/index.html"));
        if (indexPath) {
          const parts = indexPath.split("/");
          parts.pop();
          commonRoot = parts.join("/") + "/";
          console.log(`Adjusted GitHub common root to index.html location: ${commonRoot}`);
        }
      }

      console.log(`Extracting ${fileNames.length} files for GitHub push (Common root: ${commonRoot || 'none'})...`);

      // 1. Get user info
      const userRes = await fetch("https://api.github.com/user", {
        headers: { 
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Accept": "application/json"
        }
      });
      
      let userData;
      try {
        userData = await userRes.json();
      } catch (e) {
        const text = await userRes.text();
        throw new Error(`GitHub API Error (${userRes.status}): ${text || 'Empty response'}`);
      }

      if (!userRes.ok) throw new Error(`GitHub Auth Error: ${userData.message || 'Unauthorized'}`);
      const username = userData.login;

      // 2. Check if repo exists, if not create it
      console.log(`Checking if repo ${repoName} exists...`);
      let repoRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
        headers: { 
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Accept": "application/json"
        }
      });

      if (repoRes.status === 404) {
        console.log(`Creating repo ${repoName}...`);
        repoRes = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "User-Agent": "CloudDeploy-Mobile",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ name: repoName, auto_init: true })
        });
        if (!repoRes.ok) {
          const err = await repoRes.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(`Failed to create repo: ${err.message}`);
        }
      }

      // 3. Get latest commit SHA from main (to use as base)
      const mainBranchRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/branches/main`, {
        headers: { 
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Accept": "application/json"
        }
      });
      const mainBranchData = await mainBranchRes.json().catch(() => ({}));
      const mainSha = mainBranchData.commit?.sha;

      // 4. Handle branch creation if not main
      let targetSha = mainSha;
      if (branch !== "main") {
        console.log(`Checking if branch ${branch} exists...`);
        const branchCheck = await fetch(`https://api.github.com/repos/${username}/${repoName}/branches/${branch}`, {
          headers: { 
            Authorization: `Bearer ${githubToken}`,
            "User-Agent": "CloudDeploy-Mobile",
            "Accept": "application/json"
          }
        });
        
        if (branchCheck.status === 404) {
          console.log(`Creating branch ${branch} from main...`);
          const createBranchRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              "User-Agent": "CloudDeploy-Mobile",
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              ref: `refs/heads/${branch}`,
              sha: mainSha
            })
          });
          if (!createBranchRes.ok) {
            const err = await createBranchRes.json().catch(() => ({ message: 'Unknown error' }));
            throw new Error(`Failed to create branch: ${err.message}`);
          }
          targetSha = mainSha;
        } else {
          const branchData = await branchCheck.json().catch(() => ({}));
          targetSha = branchData.commit?.sha;
        }
      }

      // 5. Create blobs for each file
      console.log("Creating blobs on GitHub...");
      const treeItems = [];
      for (const filename of fileNames) {
        const file = content.files[filename];
        const buffer = await file.async("nodebuffer");
        const blobRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "User-Agent": "CloudDeploy-Mobile",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            content: buffer.toString("base64"),
            encoding: "base64"
          })
        });
        const blobData = await blobRes.json().catch(() => ({}));
        if (!blobRes.ok) throw new Error(`Failed to create blob for ${filename}: ${blobData.message || 'Unknown error'}`);
        
        let cleanPath = filename;
        if (commonRoot && cleanPath.startsWith(commonRoot)) {
          cleanPath = cleanPath.substring(commonRoot.length);
        }

        treeItems.push({
          path: cleanPath,
          mode: "100644",
          type: "blob",
          sha: blobData.sha
        });
      }

      // 6. Create tree
      console.log("Creating tree on GitHub...");
      const treeRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/trees`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          base_tree: targetSha,
          tree: treeItems
        })
      });
      const treeData = await treeRes.json().catch(() => ({}));
      if (!treeRes.ok) throw new Error(`Failed to create tree: ${treeData.message || 'Unknown error'}`);

      // 7. Create commit
      console.log("Creating commit on GitHub...");
      const commitRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/commits`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          message: commitMessage || "Deploy from CloudDeploy",
          tree: treeData.sha,
          parents: targetSha ? [targetSha] : []
        })
      });
      const commitData = await commitRes.json().catch(() => ({}));
      if (!commitRes.ok) throw new Error(`Failed to create commit: ${commitData.message || 'Unknown error'}`);

      // 8. Update reference
      console.log(`Updating ${branch} branch reference...`);
      const refRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${branch}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ sha: commitData.sha, force: true })
      });
      if (!refRes.ok) {
        const err = await refRes.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(`Failed to update ref: ${err.message}`);
      }

      // 9. Create Pull Request if not main
      let prUrl = null;
      if (branch !== "main") {
        console.log(`Creating Pull Request for ${branch}...`);
        const prRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/pulls`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "User-Agent": "CloudDeploy-Mobile",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            title: `Deploy: ${commitMessage || "New update"}`,
            head: branch,
            base: "main",
            body: "This pull request was automatically created by CloudDeploy."
          })
        });
        const prData = await prRes.json().catch(() => ({}));
        if (prRes.ok) {
          prUrl = prData.html_url;
        } else {
          console.warn("PR creation failed (might already exist):", prData.message);
        }
      }

      console.log("GitHub push successful!");
      res.json({ 
        success: true, 
        repoUrl: `https://github.com/${username}/${repoName}`,
        branchUrl: `https://github.com/${username}/${repoName}/tree/${branch}`,
        prUrl,
        cloudflareUrl: `https://${projectName || repoName}.pages.dev`,
        branch,
        message: `Files pushed to GitHub branch ${branch} successfully`
      });

    } catch (error: any) {
      console.error("GitHub Deployment Error:", error);
      res.status(500).json({ error: error.message || "Unknown GitHub error" });
    }
  });

  // API Route to get the latest deployment status
  app.get("/api/deployment-status", async (req, res) => {
    const { accountId, apiToken, projectName } = req.query;

    if (!accountId || !apiToken || !projectName) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(`Failed to fetch deployments: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
      }

      const data = await response.json();
      const latest = data.result?.[0];

      if (!latest) {
        return res.json({ status: "none" });
      }

      res.json({
        id: latest.id,
        status: latest.latest_stage?.status || latest.status,
        url: latest.url,
        project_url: `https://${projectName}.pages.dev`,
        stages: latest.stages
      });
    } catch (error: any) {
      console.error("Cloudflare Status Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to setup Cloudflare Pages project (direct upload mode - no GitHub OAuth needed)
  // NOTE: Cloudflare Pages does NOT support linking GitHub repos via REST API without OAuth.
  // Instead, this route simply ensures the project exists as a direct-upload project.
  // Cloudflare will pick up pushes once the user manually connects GitHub in the dashboard once.
  app.post("/api/cloudflare-setup", async (req, res) => {
    const { projectName, accountId, apiToken, buildCommand, outputDir } = req.body;

    if (!projectName || !accountId || !apiToken) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      // Check if project exists
      const projectCheck = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );

      if (projectCheck.status === 404) {
        console.log(`Creating Cloudflare Pages project: ${projectName}`);
        const createRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: projectName,
              production_branch: "main",
              build_config: {
                build_command: buildCommand || "",
                destination_dir: outputDir || ".",
              }
            }),
          }
        );

        if (!createRes.ok) {
          const err = await createRes.json();
          throw new Error(`Cloudflare project creation failed: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
        }
        console.log(`Project ${projectName} created successfully`);
      } else if (projectCheck.ok) {
        console.log(`Project ${projectName} already exists — skipping creation`);
      } else {
        const err = await projectCheck.json();
        throw new Error(`Failed to check project: ${err.errors?.[0]?.message || JSON.stringify(err)}`);
      }

      res.json({ success: true, url: `https://${projectName}.pages.dev` });
    } catch (error: any) {
      console.error("Cloudflare Setup Error:", error);
      res.status(500).json({ error: error.message });
    }
  });


  // API Route: Deploy extracted ZIP directly to Cloudflare Pages (direct upload)
  // Used by the GitHub flow to push built files to CF without needing GitHub<->CF OAuth
  app.post("/api/deploy-to-cloudflare", async (req, res) => {
    const { projectName, accountId, apiToken, zipFile, buildOnServer, buildCommand, outputDir } = req.body;

    const cfToken = apiToken || process.env.CLOUDFLARE_API_TOKEN;
    const cfAccountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!cfToken || !cfAccountId || !zipFile || !projectName) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      console.log(`Direct CF deploy for project: ${projectName}`);
      let fileBuffers: Record<string, Buffer> = {};
      const zipBuffer = Buffer.from(zipFile, "base64");

      if (buildOnServer) {
        fileBuffers = await buildSource(zipBuffer, buildCommand, outputDir);
      } else {
        const zip = new JSZip();
        const content = await zip.loadAsync(zipBuffer);
        
        const fileNames = Object.keys(content.files).filter(name => {
          return !content.files[name].dir && !name.includes("__MACOSX") && !name.includes(".DS_Store");
        });

        let commonRoot = "";
        if (fileNames.length > 0) {
          const allParts = fileNames.map(name => name.split("/"));
          const minLen = Math.min(...allParts.map(p => p.length));
          let commonParts: string[] = [];
          for (let i = 0; i < minLen - 1; i++) {
            const part = allParts[0][i];
            if (allParts.every(p => p[i] === part)) commonParts.push(part);
            else break;
          }
          if (commonParts.length > 0) commonRoot = commonParts.join("/") + "/";
        }

        // Adjust root to where index.html lives
        const hasIndexAtRoot = fileNames.find(n => n.substring(commonRoot.length) === "index.html");
        if (!hasIndexAtRoot) {
          const indexPath = fileNames.find(n => n.endsWith("/index.html"));
          if (indexPath) {
            const parts = indexPath.split("/");
            parts.pop();
            commonRoot = parts.join("/") + "/";
          }
        }

        for (const filename of fileNames) {
          let cleanPath = filename.startsWith(commonRoot) ? filename.substring(commonRoot.length) : filename;
          cleanPath = cleanPath.replace(/^\/+/, "");
          if (cleanPath) fileBuffers[cleanPath] = await content.files[filename].async("nodebuffer");
        }
      }

      // Ensure project exists
      const projectCheck = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}`,
        { headers: { Authorization: `Bearer ${cfToken}` } }
      );

      if (projectCheck.status === 404) {
        const createRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: projectName, production_branch: "main" }),
          }
        );
        if (!createRes.ok) {
          const err = await createRes.json();
          throw new Error(`Failed to create project: ${err.errors?.[0]?.message}`);
        }
      }

      // Build manifest
      const manifest: Record<string, string> = {};
      for (const [filePath, buffer] of Object.entries(fileBuffers)) {
        manifest["/" + filePath] = crypto.createHash("sha256").update(buffer).digest("hex");
      }

      if (!manifest["/index.html"]) {
        const keys = Object.keys(manifest).slice(0, 10).join(", ");
        throw new Error(`index.html not found. Files: ${keys}`);
      }

      // Upload to Cloudflare
      const formData = new FormData();
      formData.append("manifest", JSON.stringify(manifest));
      formData.append("metadata", JSON.stringify({ branch: "main" }));
      for (const [filePath, buffer] of Object.entries(fileBuffers)) {
        const contentType = mime.lookup(filePath) || "application/octet-stream";
        formData.append(filePath, new Blob([buffer], { type: contentType }), filePath);
      }

      const deployRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`,
        { method: "POST", headers: { Authorization: `Bearer ${cfToken}` }, body: formData }
      );

      const deployData = await deployRes.json();
      if (!deployRes.ok) {
        throw new Error(`Cloudflare deploy error: ${deployData.errors?.[0]?.message || "Unknown"}`);
      }

      console.log(`Direct CF deploy successful: ${projectName}`);
      res.json({
        success: true,
        url: `https://${projectName}.pages.dev`,
        previewUrl: deployData.result?.url,
      });
    } catch (error: any) {
      console.error("Direct CF deploy error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to merge branch to main
  app.post("/api/github-merge", async (req, res) => {
    const { githubToken, repoName, head } = req.body;

    if (!githubToken || !repoName || !head) {
      return res.status(400).json({ error: "Missing GitHub credentials or head branch" });
    }

    try {
      // 1. Get user info
      const userRes = await fetch("https://api.github.com/user", {
        headers: { 
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Accept": "application/json"
        }
      });
      const userData = await userRes.json().catch(() => ({}));
      const username = userData.login;

      // 2. Merge branch to main
      console.log(`Merging ${head} into main for ${repoName}...`);
      const mergeRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/merges`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "CloudDeploy-Mobile",
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          base: "main",
          head: head,
          commit_message: `Promote ${head} to production`
        })
      });

      const mergeData = await mergeRes.json().catch(() => ({}));
      if (!mergeRes.ok) {
        throw new Error(`Merge failed: ${mergeData.message || 'Unknown error'}`);
      }

      res.json({ success: true, message: "Merged successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
