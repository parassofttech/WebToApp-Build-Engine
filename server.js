
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5001;
const ROOT = __dirname;
const OUTPUT_DIR = path.join(ROOT, "output");
const INPUT_DIR = path.join(ROOT, "input", "uploads");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

const API_KEY = process.env.BUILD_ENGINE_API_KEY;

for (const dir of [OUTPUT_DIR, INPUT_DIR, ARTIFACTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}



const jobs = new Map();
let activeBuild = false;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INPUT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    const valid = allowed.includes(file.mimetype);

    cb(
      valid ? null : new Error("Logo must be PNG, JPG, or WEBP."),
      valid
    );
  },
});


function authorize(req, res, next) {
  const configured = Boolean(API_KEY);
  const received = req.get("x-api-key");

  const authorized =
    configured &&
    typeof received === "string" &&
    received === API_KEY;

  console.log("[BUILD ENGINE] API authentication", {
    configured,
    headerReceived: typeof received === "string",
    authorized,
    method: req.method,
    path: req.path,
  });

  if (!authorized) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  next();
}


function validWebsiteUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validAppName(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 50 &&
    /^[a-zA-Z0-9 _.-]+$/.test(value.trim())
  );
}

function getOutputFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(apk|aab)$/i.test(name));
}

function publicJob(job) {
  return {
    buildId: job.buildId,
    status: job.status,
    progress: job.progress,
    error: job.error || null,
    files: job.files || [],
    logs: job.logs || "",
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
  };
}

function startNextBuild() {
  if (activeBuild) return;

  const next = [...jobs.values()].find(
    (job) => job.status === "queued"
  );

  if (next) {
    runBuild(next);
  }
}

async function runBuild(job) {
  if (activeBuild) return;

  activeBuild = true;
  job.status = "building";
  job.progress = 5;
  job.startedAt = new Date().toISOString();

  const artifactDir = path.join(ARTIFACTS_DIR, job.buildId);

  try {
    fs.mkdirSync(artifactDir, { recursive: true });

    // The build script writes into the shared output folder.
    // Clear old files before starting the next build.
    for (const file of fs.readdirSync(OUTPUT_DIR)) {
      fs.rmSync(path.join(OUTPUT_DIR, file), {
        recursive: true,
        force: true,
      });
    }

    const args = [
      "run",
      "build",
      "--",
      "--url",
      job.websiteUrl,
      "--name",
      job.appName,
    ];

    if (job.logoPath) {
      args.push("--logo", job.logoPath);
    }

    console.log(`Starting build ${job.buildId}`);

    const child = spawn("npm", args, {
      cwd: ROOT,
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let logs = "";

    function onOutput(chunk) {
      const text = chunk.toString();

      logs = (logs + text).slice(-12000);
      job.logs = logs;

      const match = text.match(/\[(\d+)\/6\]/);

      if (match) {
        const stage = Number(match[1]);
        job.progress = Math.min(
          95,
          Math.max(job.progress, Math.round(stage / 6 * 100))
        );
      }
    }

    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);

    await new Promise((resolve, reject) => {
      child.once("error", reject);

      child.once("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Build process exited with code ${code}.\n${logs.slice(-4000)}`
            )
          );
        }
      });
    });

    // Copy the generated files into a directory unique to this build.
    const generated = getOutputFiles(OUTPUT_DIR);

    if (generated.length === 0) {
      throw new Error(
        "Build completed, but no APK/AAB files were found in output/."
      );
    }

    for (const filename of generated) {
      await fs.promises.copyFile(
        path.join(OUTPUT_DIR, filename),
        path.join(artifactDir, filename)
      );
    }

    job.files = generated;
    job.status = "completed";
    job.progress = 100;
    job.finishedAt = new Date().toISOString();

    console.log(`Build completed: ${job.buildId}`);
  } catch (error) {
    job.status = "failed";
    job.error = error.message || "Build failed";
    job.finishedAt = new Date().toISOString();

    console.error(`Build failed: ${job.buildId}`, error);
  } finally {
    if (job.logoPath) {
      await fs.promises.unlink(job.logoPath).catch(() => {});
    }

    activeBuild = false;
    startNextBuild();
  }
}

// Public health endpoints
app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Build Engine service is running.",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "build-engine",
    activeBuild,
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Build Engine service is running.",
  });
});

console.log("[BUILD ENGINE] POST /api/builds received");

// Create a build

app.post(
  "/api/builds",
  authorize,
  (req, res, next) => {
    console.log("[BUILD ENGINE] POST authenticated", {
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"] || "unknown",
    });

    next();
  },
  upload.single("logo"),
  (req, res) => {
    console.log("[BUILD ENGINE] Multipart upload parsed", {
      hasUrl: Boolean(req.body?.url),
      hasAppName: Boolean(req.body?.appName),
      hasLogo: Boolean(req.file),
    });

    const { url, appName } = req.body || {};

    if (!validWebsiteUrl(url)) {
      if (req.file) {
        fs.rmSync(req.file.path, { force: true });
      }

      return res.status(400).json({
        error: "A valid website URL is required.",
      });
    }

    if (!validAppName(appName)) {
      if (req.file) {
        fs.rmSync(req.file.path, { force: true });
      }

      return res.status(400).json({
        error: "Invalid app name.",
      });
    }

    const buildId = crypto.randomUUID();

    const job = {
      buildId,
      websiteUrl: url,
      appName: appName.trim(),
      logoPath: req.file ? req.file.path : null,
      status: "queued",
      progress: 0,
      files: [],
      logs: "",
      error: null,
      createdAt: new Date().toISOString(),
    };

    jobs.set(buildId, job);

    console.log("[BUILD ENGINE] Job created", {
      buildId,
      appName: job.appName,
      status: job.status,
    });

    startNextBuild();

    return res.status(202).json({
      success: true,
      buildId,
      status: job.status,
      message: "Build request accepted.",
    });
  }
);


// Check build status
app.get("/api/builds/:id", authorize, (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({ error: "Build not found." });
  }

  return res.json(publicJob(job));
});

// Download APK/AAB
app.get(
  "/api/builds/:id/download/:filename",
  authorize,
  (req, res) => {
    const job = jobs.get(req.params.id);
    const filename = req.params.filename;

    if (!job || job.status !== "completed") {
      return res.status(404).json({
        error: "Completed build not found.",
      });
    }

    if (
      path.basename(filename) !== filename ||
      !job.files.includes(filename) ||
      !/\.(apk|aab)$/i.test(filename)
    ) {
      return res.status(404).json({
        error: "Build artifact not found.",
      });
    }

    const filePath = path.join(
      ARTIFACTS_DIR,
      job.buildId,
      filename
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Artifact file is missing.",
      });
    }

    return res.download(filePath);
  }
);

app.use((err, _req, res, _next) => {
  console.error("API error:", err);

  const status =
    err instanceof multer.MulterError ? 400 : 500;

  res.status(status).json({
    error: err.message || "Internal server error.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Build Engine listening on port ${PORT}`);
});
