const fs = require("fs").promises;
const path = require("path");

const ROOT = path.resolve(
  __dirname,
  ".."
);

async function findLatestProject() {
  const tempDir =
    path.join(ROOT, "temp");

  const entries =
    await fs.readdir(
      tempDir,
      {
        withFileTypes: true
      }
    );

  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectPath =
      path.join(
        tempDir,
        entry.name
      );

    try {
      const metaPath =
        path.join(
          projectPath,
          "build-meta.json"
        );

      const stat =
        await fs.stat(metaPath);

      projects.push({
        projectPath,
        time: stat.mtimeMs
      });
    } catch {
      // Ignore
    }
  }

  if (!projects.length) {
    throw new Error(
      "No generated project found."
    );
  }

  projects.sort(
    (a, b) =>
      b.time - a.time
  );

  return projects[0].projectPath;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function main() {
  const projectDir =
    await findLatestProject();

  const metaPath =
    path.join(
      projectDir,
      "build-meta.json"
    );

  const meta =
    JSON.parse(
      await fs.readFile(
        metaPath,
        "utf8"
      )
    );

  const androidDir =
    path.join(
      projectDir,
      "android"
    );

  /*
   * Find Gradle file
   */
  const groovyPath =
    path.join(
      androidDir,
      "app",
      "build.gradle"
    );

  const kotlinPath =
    path.join(
      androidDir,
      "app",
      "build.gradle.kts"
    );

  let gradlePath = null;

  try {
    await fs.access(
      groovyPath
    );

    gradlePath = groovyPath;
  } catch {}

  if (!gradlePath) {
    try {
      await fs.access(
        kotlinPath
      );

      gradlePath =
        kotlinPath;
    } catch {}
  }

  if (!gradlePath) {
    throw new Error(
      "Android Gradle file not found."
    );
  }

  let gradle =
    await fs.readFile(
      gradlePath,
      "utf8"
    );

  /*
   * applicationId
   */
  if (
    gradlePath.endsWith(
      "build.gradle"
    )
  ) {
    gradle =
      gradle.replace(
        /applicationId\s+["'][^"']+["']/,
        `applicationId "${meta.packageName}"`
      );
  }

  if (
    gradlePath.endsWith(
      "build.gradle.kts"
    )
  ) {
    gradle =
      gradle.replace(
        /applicationId\s*=\s*["'][^"']+["']/,
        `applicationId = "${meta.packageName}"`
      );
  }

  await fs.writeFile(
    gradlePath,
    gradle,
    "utf8"
  );

  /*
   * strings.xml
   */
  const stringsPath =
    path.join(
      androidDir,
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml"
    );

  try {
    let strings =
      await fs.readFile(
        stringsPath,
        "utf8"
      );

    if (
      strings.includes(
        'name="app_name"'
      )
    ) {
      strings =
        strings.replace(
          /<string name="app_name">.*?<\/string>/,
          `<string name="app_name">${escapeXml(
            meta.appName
          )}</string>`
        );
    } else {
      strings =
        strings.replace(
          "</resources>",
          `    <string name="app_name">${escapeXml(
            meta.appName
          )}</string>\n</resources>`
        );
    }

    await fs.writeFile(
      stringsPath,
      strings,
      "utf8"
    );
  } catch {
    console.log(
      "strings.xml not found."
    );
  }

  /*
   * Android Manifest
   */
  const manifestPath =
    path.join(
      androidDir,
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );

  let manifest =
    await fs.readFile(
      manifestPath,
      "utf8"
    );

  if (
    !manifest.includes(
      "android.permission.INTERNET"
    )
  ) {
    const manifestTagEnd =
      manifest.indexOf(">");

    if (
      manifestTagEnd !== -1
    ) {
      manifest =
        manifest.slice(
          0,
          manifestTagEnd + 1
        ) +
        `\n\n    <uses-permission android:name="android.permission.INTERNET" />` +
        manifest.slice(
          manifestTagEnd + 1
        );
    }
  }

  await fs.writeFile(
    manifestPath,
    manifest,
    "utf8"
  );

  console.log(
    "\nAndroid app configured successfully."
  );

  console.log(
    "App Name:",
    meta.appName
  );

  console.log(
    "Package:",
    meta.packageName
  );
}

main().catch((error) => {
  console.error(
    "\nCONFIGURATION ERROR:"
  );

  console.error(
    error.message
  );

  process.exit(1);
});