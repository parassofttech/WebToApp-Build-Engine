const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config();

const ROOT = path.resolve(
  __dirname,
  ".."
);

function getArg(name) {
  const args =
    process.argv.slice(2);

  const index =
    args.indexOf(name);

  if (index === -1) {
    return null;
  }

  return args[index + 1] || null;
}

function run(command, args) {
  return new Promise(
    (resolve, reject) => {
      console.log(
        "\n================================"
      );

      console.log(
        `> ${command} ${args.join(" ")}`
      );

      console.log(
        "================================"
      );

      const child =
        spawn(
          command,
          args,
          {
            cwd: ROOT,
            shell: true,
            stdio: "inherit",
            env: process.env
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

async function main() {
  const url =
    getArg("--url");

  const name =
    getArg("--name");

  const logo =
    getArg("--logo");

  if (!url) {
    throw new Error(
      "Missing --url."
    );
  }

  if (!name) {
    throw new Error(
      "Missing --name."
    );
  }

  console.log(`
╔══════════════════════════════════════════════╗
║       WEBSITE → ANDROID BUILD ENGINE        ║
╚══════════════════════════════════════════════╝
`);

  console.log(
    "Website :",
    url
  );

  console.log(
    "App Name:",
    name
  );

  console.log(
    "Logo    :",
    logo || "Not provided"
  );

  /*
   * 1. Create project
   */
  console.log(
    "\n[1/6] Creating Capacitor project..."
  );

  const createArgs = [
    "scripts/create-project.js",
    "--url",
    url,
    "--name",
    name
  ];

  if (logo) {
    createArgs.push(
      "--logo",
      logo
    );
  }

  await run(
    "node",
    createArgs
  );

  /*
   * 2. Configure
   */
  console.log(
    "\n[2/6] Configuring Android..."
  );

  await run(
    "node",
    [
      "scripts/configure-app.js"
    ]
  );

  /*
   * 3. Icons
   */
  console.log(
    "\n[3/6] Generating app icon..."
  );

  if (logo) {
    await run(
      "node",
      [
        "scripts/generate-icons.js"
      ]
    );
  } else {
    console.log(
      "No logo supplied. Skipping."
    );
  }

  /*
   * 4. APK
   */
  console.log(
    "\n[4/6] Building APK..."
  );

  await run(
    "node",
    [
      "scripts/build-apk.js"
    ]
  );

  /*
   * 5. AAB
   */
  console.log(
    "\n[5/6] Building AAB..."
  );

  await run(
    "node",
    [
      "scripts/build-aab.js"
    ]
  );

  /*
   * 6. Final
   */
  console.log(
    "\n[6/6] Finalizing..."
  );

  const outputDir =
    path.join(
      ROOT,
      "output"
    );

  const files =
    await fs.readdir(
      outputDir
    );

  console.log(`
╔══════════════════════════════════════════════╗
║              BUILD COMPLETE                 ║
╚══════════════════════════════════════════════╝
`);

  files.forEach(
    (file) => {
      console.log(
        " →",
        path.join(
          outputDir,
          file
        )
      );
    }
  );
}

main().catch(
  (error) => {
    console.error(
      "\n❌ BUILD FAILED"
    );

    console.error(
      error.message
    );

    process.exit(1);
  }
);