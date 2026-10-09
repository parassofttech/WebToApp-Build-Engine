require("dotenv").config();

const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMP_DIR = path.join(ROOT, "temp");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(options.env || {})
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with code ${code}`
          )
        );
      }
    });
  });
}

function getArg(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);

  if (index === -1) {
    return null;
  }

  const values = [];

  for (let i = index + 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      break;
    }

    values.push(args[i]);
  }

  return values.join(" ").trim() || null;
}

function validateUrl(url) {
  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(
        "Only HTTP and HTTPS URLs are supported."
      );
    }

    return parsed.toString();
  } catch {
    throw new Error(`Invalid website URL: ${url}`);
  }
}

function sanitizeProjectName(name) {
  const result = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  return result || "WebsiteApp";
}

function generatePackageName(appName) {
  let clean = appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  clean = clean.slice(0, 30);

  if (!clean) {
    clean = `app${Date.now()}`;
  }

  return `com.webtoapp.${clean}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  const websiteUrlArg = getArg("--url");
  const appNameArg = getArg("--name");
  const logoArg = getArg("--logo");

  if (!websiteUrlArg) {
    throw new Error(
      "Website URL is required. Use --url."
    );
  }

  if (!appNameArg) {
    throw new Error(
      "App name is required. Use --name."
    );
  }

  const websiteUrl = validateUrl(
    websiteUrlArg
  );

  const appName = appNameArg.trim();

  const logoPath = logoArg
    ? path.resolve(logoArg)
    : null;

  if (logoPath) {
    try {
      await fs.access(logoPath);
    } catch {
      throw new Error(
        `Logo not found: ${logoPath}`
      );
    }
  }

  const projectName =
    sanitizeProjectName(appName);

  const packageName =
    generatePackageName(appName);

  const projectDir = path.join(
    TEMP_DIR,
    `${projectName}-${Date.now()}`
  );

  console.log("\n====================================");
  console.log(" WEBSITE TO APP BUILD ENGINE");
  console.log("====================================");

  console.log("Website :", websiteUrl);
  console.log("App Name:", appName);
  console.log("Package :", packageName);
  console.log("Project :", projectDir);

  await fs.mkdir(
    TEMP_DIR,
    {
      recursive: true
    }
  );

  await fs.mkdir(
    projectDir,
    {
      recursive: true
    }
  );

  /*
   * Create package.json
   */
  const packageJson = {
    name: projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-"),

    version: "1.0.0",

    private: true,

    dependencies: {
      "@capacitor/android": "^8.0.0",
      "@capacitor/core": "^8.0.0"
    },

    devDependencies: {
      "@capacitor/cli": "^8.0.0",
      "@capacitor/assets": "^3.0.0"
    }
  };

  await fs.writeFile(
    path.join(
      projectDir,
      "package.json"
    ),
    JSON.stringify(
      packageJson,
      null,
      2
    ),
    "utf8"
  );

  /*
   * Create www directory
   */
  const wwwDir = path.join(
    projectDir,
    "www"
  );

  await fs.mkdir(
    wwwDir,
    {
      recursive: true
    }
  );

  /*
   * Local HTML shell
   */
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width,
    initial-scale=1.0,
    viewport-fit=cover"
  >

  <meta
    name="theme-color"
    content="#111827"
  >

  <title>${escapeHtml(appName)}</title>

  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
    }

    #loader {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      z-index: 999999;
    }

    .loader {
      width: 44px;
      height: 44px;
      border: 4px solid #e5e7eb;
      border-top-color: #111827;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }

      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>

<body>

<div id="loader">
  <div class="loader"></div>
</div>

<script>
  const websiteUrl =
    ${JSON.stringify(websiteUrl)};

  window.addEventListener(
    "load",
    () => {
      setTimeout(() => {
        window.location.replace(
          websiteUrl
        );
      }, 150);
    }
  );
</script>

</body>
</html>
`;

  await fs.writeFile(
    path.join(
      wwwDir,
      "index.html"
    ),
    indexHtml,
    "utf8"
  );

  /*
   * Capacitor JavaScript config
   */
  const capacitorConfig = `const config = {
  appId: ${JSON.stringify(packageName)},
  appName: ${JSON.stringify(appName)},
  webDir: "www",
  bundledWebRuntime: false
};

module.exports = config;
`;

  await fs.writeFile(
    path.join(
      projectDir,
      "capacitor.config.js"
    ),
    capacitorConfig,
    "utf8"
  );

  /*
   * Install dependencies
   */
  await run(
    "npm",
    ["install"],
    {
      cwd: projectDir
    }
  );

  /*
   * Add Android
   */
  await run(
    "npx",
    ["cap", "add", "android"],
    {
      cwd: projectDir
    }
  );

  /*
   * Metadata
   */
  const metadata = {
    websiteUrl,
    appName,
    packageName,
    projectName,
    projectDir,
    logoPath,
    createdAt:
      new Date().toISOString()
  };

  await fs.writeFile(
    path.join(
      projectDir,
      "build-meta.json"
    ),
    JSON.stringify(
      metadata,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "\nAndroid project created successfully."
  );

  return metadata;
}

main().catch((error) => {
  console.error(
    "\nBUILD ENGINE ERROR:"
  );

  console.error(
    error.message
  );

  process.exit(1);
});