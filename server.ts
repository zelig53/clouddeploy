import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Cloudflare Proxy Endpoint
  app.use("/api/cloudflare", async (req, res) => {
    const cfPath = req.path.replace(/^\//, "");
    const cfUrl = `https://api.cloudflare.com/client/v4/${cfPath}`;
    const queryParams = new URLSearchParams(req.query as any).toString();
    const finalUrl = queryParams ? `${cfUrl}?${queryParams}` : cfUrl;

    console.log(`Proxying ${req.method} to Cloudflare: ${finalUrl}`);

    try {
      const response = await axios({
        url: finalUrl,
        method: req.method,
        headers: {
          "Authorization": req.headers.authorization || "",
          "Content-Type": "application/json",
        },
        data: ["POST", "PUT", "PATCH"].includes(req.method) ? req.body : undefined,
      });

      res.status(response.status).json(response.data);
    } catch (error: any) {
      console.error("Cloudflare Proxy Error:", error.response?.data || error.message);
      const status = error.response?.status || 500;
      const data = error.response?.data || { success: false, errors: [{ message: error.message }] };
      res.status(status).json(data);
    }
  });

  // GitHub Proxy Endpoint
  app.use("/api/github", async (req, res) => {
    const ghPath = req.path.replace(/^\//, "");
    const ghUrl = `https://api.github.com/${ghPath}`;
    const queryParams = new URLSearchParams(req.query as any).toString();
    const finalUrl = queryParams ? `${ghUrl}?${queryParams}` : ghUrl;

    console.log(`Proxying ${req.method} to GitHub: ${finalUrl}`);
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      const bodyKeys = Object.keys(req.body);
      console.log(`Request body keys: ${bodyKeys.join(", ")}`);
      if (req.body.path) console.log(`Target path: ${req.body.path}`);
    }

    try {
      const response = await axios({
        url: finalUrl,
        method: req.method,
        headers: {
          "Authorization": req.headers.authorization || "",
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "CloudDeploy-PWA"
        },
        data: ["POST", "PUT", "PATCH"].includes(req.method) ? req.body : undefined,
      });

      res.status(response.status).json(response.data);
    } catch (error: any) {
      console.error("GitHub Proxy Error:", error.response?.data || error.message);
      const status = error.response?.status || 500;
      const data = error.response?.data || { message: error.message };
      res.status(status).json(data);
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
