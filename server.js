const express = require("express");
const { exec } = require("child_process");
const path = require("path");

const app = express();
app.use(express.json());

// Health Check Route
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Build Engine service is running.",
  });
});

// Backend se build trigger karne ka route
app.post("/api/trigger-build", async (req, res) => {
  const { websiteUrl, buildId, appName } = req.body;

  if (!websiteUrl) {
    return res.status(400).json({
      success: false,
      error: "Website URL is required",
    });
  }

  // Backend ko turant response de do taaki connection timeout na ho
  res.json({
    success: true,
    message: "Build process initiated in background.",
    buildId,
  });

  console.log(`🚀 Building app for URL: ${websiteUrl} [ID: ${buildId}]`);

  // Capacitor / Gradle build command
  const buildCommand = `npx cap sync android && cd android && ./gradlew assembleRelease`;

  exec(buildCommand, { cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Build Failed for ${buildId}: ${error.message}`);
      console.error(stderr);
      return;
    }

    console.log(`✅ Build Successful for ${buildId}!`);
    console.log(stdout);
    
    // TODO: Yahan generated APK ko Cloud (Supabase/S3) par upload karne ka code aayega
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Build Engine running on port ${PORT}`);
});