
require("dotenv").config();

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const ANDROID_HOME =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  "/opt/android-sdk";

/**
 * Resolve a valid Java installation.
 * An invalid JAVA_HOME environment variable will be skipped.
 */
function resolveJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    "/usr/lib/jvm/java-21-openjdk-amd64",
    "/usr/lib/jvm/java-17-openjdk-amd64",
    "/usr/lib/jvm/default-java",
    "/opt/java/openjdk",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const javaExecutable = path.join(candidate, "bin", "java");
    const javacExecutable = path.join(candidate, "bin", "javac");

    if (
      fsSync.existsSync(javaExecutable) &&
      fsSync.existsSync(javacExecutable)
    ) {
      return candidate;
    }
  }

  // Try to detect Java from javac's actual installation path.
  try {
    const javacPath = execFileSync(
      "bash",
      ["-lc", "readlink -f \"$(command -v javac)\""],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();

    if (javacPath) {
      const detectedHome = path.dirname(
        path.dirname(javacPath)
      );

      if (
        fsSync.existsSync(
          path.join(detectedHome, "bin", "java")
        ) &&
        fsSync.existsSync(
          path.join(detectedHome, "bin", "javac")
        )
      ) {
        return detectedHome;
      }
    }
  } catch (error) {
    console.error(
      "[JAVA] Automatic detection failed:",
      error.message
    );
  }

  throw new Error(
    "Valid Java JDK not found. Check the Build Engine Dockerfile, " +
      "and make sure JAVA_HOME points to a directory containing bin/java and bin/javac."
  );
}

const JAVA_HOME = resolveJavaHome();

const env = {
  ...process.env,

  JAVA_HOME,
  ANDROID_HOME,
  ANDROID_SDK_ROOT: ANDROID_HOME,

  PATH: [
    path.join(JAVA_HOME, "bin"),
    path.join(ANDROID_HOME, "cmdline-tools", "latest", "bin"),
    path.join(ANDROID_HOME, "platform-tools"),
    path.join(ANDROID_HOME, "build-tools", "36.0.0"),
    process.env.PATH || "",
  ]
    .filter(Boolean)
    .join(path.delimiter),
};

console.log("[ENV] Resolved JAVA_HOME:", JAVA_HOME);
console.log("[ENV] ANDROID_HOME:", ANDROID_HOME);

/**
 * Run a command and reject if it fails.
 */
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
    console.log("[ENV] Working directory:", cwd);
    console.log("[ENV] JAVA_HOME:", env.JAVA_HOME);
    console.log("[ENV] ANDROID_SDK_ROOT:", env.ANDROID_SDK_ROOT);

    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env,
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Could not start "${command}": ${error.message}`
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
          `"${command}" failed with exit code ${code}` +
            (signal ? ` (signal: ${signal})` : "")
        )
      );
    });
  });
}

/**
 * Find the newest generated project.
 */
async function findLatestProject() {
  const tempDir = path.join(ROOT, "temp");

  let entries;

  try {
    entries = await fs.readdir(tempDir, {
      withFileTypes: true,
    });
  } catch (error) {
    throw new Error(
      `Cannot read project directory "${tempDir}": ${error.message}`
    );
  }

  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectDir = path.join(tempDir, entry.name);
    const metaPath = path.join(
      projectDir,
      "build-meta.json"
    );

    try {
      const stat = await fs.stat(metaPath);

      projects.push({
        dir: projectDir,
        time: stat.mtimeMs,
      });
    } catch {
      // Ignore directories without build metadata.
    }
  }

  if (projects.length === 0) {
    throw new Error(
      `No generated project found in "${tempDir}".`
    );
  }

  projects.sort((a, b) => b.time - a.time);

  return projects[0].dir;
}

/**
 * Create a safe filename from the app name.
 */
function slugify(value) {
  const slug = String(value || "android-app")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");

  return slug || "android-app";
}

/**
 * Main APK build process.
 */
async function main() {
  console.log("\n================================");
  console.log(" WEBSITE TO ANDROID APK BUILDER");
  console.log("================================");

  // Validate Java installation.
  await run("java", ["-version"], ROOT);
  await run("javac", ["-version"], ROOT);

  // Validate Android SDK installation.
  if (!fsSync.existsSync(ANDROID_HOME)) {
    throw new Error(
      `Android SDK not found at "${ANDROID_HOME}". ` +
        "Check ANDROID_HOME / ANDROID_SDK_ROOT and the Dockerfile."
    );
  }

  const projectDir = await findLatestProject();

  const metaPath = path.join(
    projectDir,
    "build-meta.json"
  );

  const meta = JSON.parse(
    await fs.readFile(metaPath, "utf8")
  );

  if (!meta.appName || !meta.packageName) {
    throw new Error(
      "build-meta.json is missing appName or packageName."
    );
  }

  const androidDir = path.join(projectDir, "android");
  const gradleWrapper = path.join(
    androidDir,
    process.platform === "win32"
      ? "gradlew.bat"
      : "gradlew"
  );

  console.log("\n================================");
  console.log(" BUILD DETAILS");
  console.log("================================");
  console.log("App Name :", meta.appName);
  console.log("Package  :", meta.packageName);
  console.log("Project  :", projectDir);
  console.log("Java     :", JAVA_HOME);
  console.log("Android  :", ANDROID_HOME);

  // Confirm that Capacitor created the Android project.
  if (!fsSync.existsSync(androidDir)) {
    throw new Error(
      `Android project directory not found: ${androidDir}. ` +
        "Make sure the project creation step ran successfully."
    );
  }

  if (!fsSync.existsSync(gradleWrapper)) {
    throw new Error(
      `Gradle wrapper not found: ${gradleWrapper}.`
    );
  }

  // Ensure Gradle wrapper is executable on Linux.
  if (process.platform !== "win32") {
    await fs.chmod(gradleWrapper, 0o755);
  }

  console.log("\n[1/4] Syncing Capacitor Android project...");

  await run(
    "npx",
    ["cap", "sync", "android"],
    projectDir
  );

  console.log("\n[2/4] Building debug APK with Gradle...");

  await run(
    process.platform === "win32"
      ? gradleWrapper
      : "./gradlew",
    [
      "assembleDebug",
      "--no-daemon",
      "--console=plain",
      "-Dorg.gradle.jvmargs=-Xmx1024m",
    ],
    androidDir
  );

  console.log("\n[3/4] Verifying generated APK...");

  const apkPath = path.join(
    androidDir,
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
    throw new Error(
      `Gradle finished but APK was not found at "${apkPath}".`
    );
  }

  const apkStats = await fs.stat(apkPath);

  if (!apkStats.isFile() || apkStats.size === 0) {
    throw new Error("Generated APK is empty or invalid.");
  }

  console.log(
    "[APK] Size:",
    `${(apkStats.size / (1024 * 1024)).toFixed(2)} MB`
  );

  console.log("\n[4/4] Copying APK to output directory...");

  const outputDir = path.join(ROOT, "output");

  await fs.mkdir(outputDir, {
    recursive: true,
  });

  const outputPath = path.join(
    outputDir,
    `${slugify(meta.appName)}-debug.apk`
  );

  await fs.copyFile(apkPath, outputPath);

  await fs.access(outputPath);

  console.log("\n================================");
  console.log(" APK BUILD SUCCESS");
  console.log("================================");
  console.log("App Name :", meta.appName);
  console.log("APK Path :", outputPath);
  console.log(
    "APK Size :",
    `${(apkStats.size / (1024 * 1024)).toFixed(2)} MB`
  );
}

main().catch((error) => {
  console.error("\n================================");
  console.error(" APK BUILD FAILED");
  console.error("================================");
  console.error(error.stack || error.message);

  process.exitCode = 1;
});









// require("dotenv").config();

// const fs = require("fs").promises;
// const path = require("path");
// const { spawn } = require("child_process");

// const ROOT = path.resolve(__dirname, "..");

// // const env = {
// //   ...process.env,
// //   JAVA_HOME: process.env.JAVA_HOME,
// //   ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
// // };




// const ANDROID_HOME =
//   process.env.ANDROID_HOME || "/opt/android-sdk";

// const JAVA_HOME =
//   process.env.JAVA_HOME ||
//   "/usr/lib/jvm/java-17-openjdk-amd64";

// const env = {
//   ...process.env,
//   JAVA_HOME,
//   ANDROID_HOME,
//   ANDROID_SDK_ROOT:
//     process.env.ANDROID_SDK_ROOT || ANDROID_HOME,
//   PATH: `${process.env.PATH || ""}:${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools`,
// };


// function run(command, args, cwd) {
//   return new Promise((resolve, reject) => {
//     console.log(`\n> ${command} ${args.join(" ")}`);

//     console.log("JAVA_HOME:", env.JAVA_HOME);
//     console.log("ANDROID_SDK_ROOT:", env.ANDROID_SDK_ROOT);

//     const child = spawn(command, args, {
//       cwd,
//       stdio: "inherit",
//       shell: true,
//       env,
//     });

//     child.on("error", reject);

//     child.on("close", (code) => {
//       if (code === 0) {
//         resolve();
//       } else {
//         reject(
//           new Error(
//             `${command} failed with code ${code}`
//           )
//         );
//       }
//     });
//   });
// }

// async function findLatestProject() {
//   const tempDir = path.join(ROOT, "temp");

//   const entries = await fs.readdir(tempDir, {
//     withFileTypes: true,
//   });

//   const projects = [];

//   for (const entry of entries) {
//     if (!entry.isDirectory()) {
//       continue;
//     }

//     const dir = path.join(tempDir, entry.name);

//     try {
//       const stat = await fs.stat(
//         path.join(dir, "build-meta.json")
//       );

//       projects.push({
//         dir,
//         time: stat.mtimeMs,
//       });
//     } catch {}
//   }

//   if (!projects.length) {
//     throw new Error("No project found.");
//   }

//   projects.sort((a, b) => b.time - a.time);

//   return projects[0].dir;
// }

// function slugify(value) {
//   return value
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, "-")
//     .replace(/^-|-$/g, "")
//     .slice(0, 50);
// }

// async function main() {
//   const projectDir = await findLatestProject();

//   const meta = JSON.parse(
//     await fs.readFile(
//       path.join(projectDir, "build-meta.json"),
//       "utf8"
//     )
//   );

//   console.log("\n================================");
//   console.log(" APK BUILD");
//   console.log("================================");
//   console.log("App Name:", meta.appName);
//   console.log("Package :", meta.packageName);
//   console.log("JAVA_HOME:", env.JAVA_HOME);

//   await run(
//     "npx",
//     ["cap", "sync", "android"],
//     projectDir
//   );

//   const gradleCommand =
//     process.platform === "win32"
//       ? "gradlew.bat"
//       : "./gradlew";

 
//   console.log("[DEBUG] Starting Gradle assembleDebug...");

//   await run(
//     gradleCommand,
//     [
//       "assembleDebug",
//       "--no-daemon",
//       "--console=plain",
//       "-Dorg.gradle.jvmargs=-Xmx1024m",
//     ],
//     path.join(projectDir, "android")
//   );

//   console.log("[DEBUG] Gradle command completed successfully.");

//   const apkPath = path.join(
//     projectDir,
//     "android",
//     "app",
//     "build",
//     "outputs",
//     "apk",
//     "debug",
//     "app-debug.apk"
//   );

//   console.log("[DEBUG] Checking APK:", apkPath);

//   await fs.access(apkPath);

//   console.log("[DEBUG] APK exists. Preparing to copy...");


//   try {
//     await fs.access(apkPath);
//   } catch {
//     throw new Error("APK was not generated.");
//   }

//   const outputDir = path.join(ROOT, "output");

//   await fs.mkdir(outputDir, {
//     recursive: true,
//   });

//   const outputPath = path.join(
//     outputDir,
//     `${slugify(meta.appName)}-debug.apk`
//   );

//   await fs.copyFile(
//     apkPath,
//     outputPath
//   );

//   console.log("\n================================");
//   console.log(" APK BUILD SUCCESS");
//   console.log("================================");
//   console.log(outputPath);
// }

// main().catch((error) => {
//   console.error("\nAPK BUILD ERROR:");
//   console.error(error.message);
//   process.exit(1);
// });