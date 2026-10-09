require("dotenv").config();

const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
};

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);

    console.log("JAVA_HOME:", env.JAVA_HOME);
    console.log("ANDROID_SDK_ROOT:", env.ANDROID_SDK_ROOT);

    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env,
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} failed with code ${code}`
          )
        );
      }
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
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = path.join(tempDir, entry.name);

    try {
      const stat = await fs.stat(
        path.join(dir, "build-meta.json")
      );

      projects.push({
        dir,
        time: stat.mtimeMs,
      });
    } catch {}
  }

  if (!projects.length) {
    throw new Error("No project found.");
  }

  projects.sort((a, b) => b.time - a.time);

  return projects[0].dir;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function main() {
  const projectDir = await findLatestProject();

  const meta = JSON.parse(
    await fs.readFile(
      path.join(projectDir, "build-meta.json"),
      "utf8"
    )
  );

  console.log("\n================================");
  console.log(" APK BUILD");
  console.log("================================");
  console.log("App Name:", meta.appName);
  console.log("Package :", meta.packageName);
  console.log("JAVA_HOME:", env.JAVA_HOME);

  await run(
    "npx",
    ["cap", "sync", "android"],
    projectDir
  );

  const gradleCommand =
    process.platform === "win32"
      ? "gradlew.bat"
      : "./gradlew";

  await run(
    gradleCommand,
    ["assembleDebug"],
    path.join(projectDir, "android")
  );

  const apkPath = path.join(
    projectDir,
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk"
  );

  try {
    await fs.access(apkPath);
  } catch {
    throw new Error("APK was not generated.");
  }

  const outputDir = path.join(ROOT, "output");

  await fs.mkdir(outputDir, {
    recursive: true,
  });

  const outputPath = path.join(
    outputDir,
    `${slugify(meta.appName)}-debug.apk`
  );

  await fs.copyFile(
    apkPath,
    outputPath
  );

  console.log("\n================================");
  console.log(" APK BUILD SUCCESS");
  console.log("================================");
  console.log(outputPath);
}

main().catch((error) => {
  console.error("\nAPK BUILD ERROR:");
  console.error(error.message);
  process.exit(1);
});