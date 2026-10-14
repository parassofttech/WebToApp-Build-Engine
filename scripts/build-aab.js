
require("dotenv").config();

const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME,
  ANDROID_HOME:
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT,
  ANDROID_SDK_ROOT:
    process.env.ANDROID_SDK_ROOT ||
    process.env.ANDROID_HOME,
};

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
    console.log("Working directory:", cwd);
    console.log("JAVA_HOME:", env.JAVA_HOME || "(not set)");
    console.log(
      "ANDROID_SDK_ROOT:",
      env.ANDROID_SDK_ROOT || "(not set)"
    );

    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      env: {
        ...env,
        ...extraEnv,
      },
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Could not start ${command}: ${error.message}`
        )
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} failed. Exit code: ${code}; signal: ${
            signal || "none"
          }`
        )
      );
    });
  });
}

async function findLatestProject() {
  const tempDir = path.join(ROOT, "temp");

  const entries = await fs.readdir(tempDir, {
    withFileTypes: true,
  });

  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(tempDir, entry.name);
    const metaPath = path.join(dir, "build-meta.json");

    try {
      const metaStat = await fs.stat(metaPath);

      projects.push({
        dir,
        time: metaStat.mtimeMs,
      });
    } catch {
      // Ignore directories without build-meta.json.
    }
  }

  if (projects.length === 0) {
    throw new Error(
      `No generated project found in: ${tempDir}`
    );
  }

  projects.sort((a, b) => b.time - a.time);

  return projects[0].dir;
}

function slugify(value) {
  return (
    String(value || "android-app")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "android-app"
  );
}

async function validateEnvironment() {
  if (!env.JAVA_HOME) {
    throw new Error(
      "JAVA_HOME is missing. Configure it in the Build Engine environment."
    );
  }

  if (!env.ANDROID_SDK_ROOT) {
    throw new Error(
      "ANDROID_SDK_ROOT is missing. Configure it in the Build Engine environment."
    );
  }

  const javaPath = path.join(env.JAVA_HOME, "bin", "java");
  const javacPath = path.join(env.JAVA_HOME, "bin", "javac");
  const sdkManagerPath = path.join(
    env.ANDROID_SDK_ROOT,
    "cmdline-tools",
    "latest",
    "bin",
    "sdkmanager"
  );

  for (const filePath of [
    javaPath,
    javacPath,
    sdkManagerPath,
  ]) {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(
        `Required build tool not found: ${filePath}`
      );
    }
  }

  console.log("\nBuild environment validation passed.");
}

async function main() {
  await validateEnvironment();

  const projectDir = await findLatestProject();

  const meta = JSON.parse(
    await fs.readFile(
      path.join(projectDir, "build-meta.json"),
      "utf8"
    )
  );

  if (!meta.appName || !meta.packageName) {
    throw new Error(
      "Invalid build-meta.json: appName or packageName is missing."
    );
  }

  const androidDir = path.join(projectDir, "android");

  try {
    await fs.access(path.join(androidDir, "gradlew"));
  } catch {
    throw new Error(
      `Gradle wrapper not found in: ${androidDir}`
    );
  }

  console.log("\n================================");
  console.log(" WEBSITE TO APP - AAB BUILD");
  console.log("================================");
  console.log("App Name:", meta.appName);
  console.log("Package:", meta.packageName);
  console.log("Project:", projectDir);

  await run(
    "java",
    ["-version"],
    projectDir
  );

  await run(
    "javac",
    ["-version"],
    projectDir
  );

  await run(
    "npx",
    ["cap", "sync", "android"],
    projectDir
  );

  await run(
    "./gradlew",
    [
      "bundleRelease",
      "--no-daemon",
      "--stacktrace",
      "--console=plain",
    ],
    androidDir
  );

  const aabPath = path.join(
    androidDir,
    "app",
    "build",
    "outputs",
    "bundle",
    "release",
    "app-release.aab"
  );

  try {
    await fs.access(aabPath);
  } catch {
    throw new Error(
      `AAB was not generated at: ${aabPath}`
    );
  }

  const outputDir = path.join(ROOT, "output");

  await fs.mkdir(outputDir, {
    recursive: true,
  });

  const outputPath = path.join(
    outputDir,
    `${slugify(meta.appName)}.aab`
  );

  await fs.copyFile(aabPath, outputPath);

  const outputStat = await fs.stat(outputPath);

  console.log("\n================================");
  console.log(" AAB BUILD SUCCESS");
  console.log("================================");
  console.log("Output:", outputPath);
  console.log(
    "File size:",
    `${(outputStat.size / (1024 * 1024)).toFixed(2)} MB`
  );
}

main().catch((error) => {
  console.error("\nAAB BUILD ERROR:");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
