const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const { spawn } = require("child_process");

const ROOT = path.resolve(
  __dirname,
  ".."
);

function run(command, args, cwd) {
  return new Promise(
    (resolve, reject) => {
      console.log(
        `\n> ${command} ${args.join(" ")}`
      );

      const child =
        spawn(
          command,
          args,
          {
            cwd,
            shell: true,
            stdio: "inherit"
          }
        );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                `${command} failed with code ${code}`
              )
            );
          }
        }
      );
    }
  );
}

async function findLatestProject() {
  const tempDir =
    path.join(
      ROOT,
      "temp"
    );

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

    const dir =
      path.join(
        tempDir,
        entry.name
      );

    try {
      const stat =
        await fs.stat(
          path.join(
            dir,
            "build-meta.json"
          )
        );

      projects.push({
        dir,
        time: stat.mtimeMs
      });
    } catch {}
  }

  if (!projects.length) {
    throw new Error(
      "No project found."
    );
  }

  projects.sort(
    (a, b) =>
      b.time - a.time
  );

  return projects[0].dir;
}

async function main() {
  const projectDir =
    await findLatestProject();

  const meta =
    JSON.parse(
      await fs.readFile(
        path.join(
          projectDir,
          "build-meta.json"
        ),
        "utf8"
      )
    );

  if (!meta.logoPath) {
    console.log(
      "No logo supplied. Skipping icon generation."
    );

    return;
  }

  const assetsDir =
    path.join(
      projectDir,
      "assets"
    );

  await fs.mkdir(
    assetsDir,
    {
      recursive: true
    }
  );

  const iconPath =
    path.join(
      assetsDir,
      "icon-only.png"
    );

  await sharp(
    meta.logoPath
  )
    .resize(
      1024,
      1024,
      {
        fit: "contain",
        background: {
          r: 255,
          g: 255,
          b: 255,
          alpha: 1
        }
      }
    )
    .png()
    .toFile(iconPath);

  console.log(
    "1024x1024 icon generated."
  );

  /*
   * Capacitor Assets
   */
  await run(
    "npx",
    [
      "capacitor-assets",
      "generate",
      "--android"
    ],
    projectDir
  );

  console.log(
    "\nAndroid icons generated successfully."
  );
}

main().catch((error) => {
  console.error(
    "\nICON GENERATION ERROR:"
  );

  console.error(
    error.message
  );

  process.exit(1);
});