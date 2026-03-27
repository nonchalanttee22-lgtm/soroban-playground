import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const router = express.Router();

router.post("/", async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "No code provided or code is not a string" });
  }

  // Define a temporary working directory for this compilation
  const tempDir = path.resolve(process.cwd(), ".tmp_compile_" + Date.now());

  try {
    // Scaffold a temp Rust project
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });

    // Write Cargo.toml
    const cargoToml = `
[package]
name = "soroban_contract"
version = "0.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "20.0.0"

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
`;
    await fs.writeFile(path.join(tempDir, "Cargo.toml"), cargoToml);

    // Write the contract code
    await fs.writeFile(path.join(tempDir, "src", "lib.rs"), code);

    // Execute Soroban CLI (or cargo block)
    // Using spawn for better security and to avoid shell injection
    const args = ["build", "--target", "wasm32-unknown-unknown", "--release"];
    const buildProcess = spawn("cargo", args, { 
      cwd: tempDir,
      // Ensure we don't allow shell interpretation
      shell: false,
      // Timeouts are handled manually for spawn in Node < 15.1.0, 
      // but we can use a signal or stick to the callback logic.
      // For simplicity in this refactor, we'll use a timer.
    });

    let stdout = "";
    let stderr = "";
    let responded = false;

    const cleanUp = async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error("Failed to clean up:", e);
      }
    };

    const timeout = setTimeout(() => {
      if (!responded) {
        buildProcess.kill();
      }
    }, 30000);

    buildProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    buildProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    buildProcess.on("error", async (err) => {
      if (responded) return;
      responded = true;
      clearTimeout(timeout);
      await cleanUp();
      return res.status(500).json({
        error: "Compilation process failed to start",
        status: "error",
        details: err.message,
      });
    });

    buildProcess.on("close", async (exitCode) => {
      if (responded) return;
      responded = true;
      clearTimeout(timeout);

      if (exitCode !== 0) {
        await cleanUp();
        return res.status(500).json({
          error: "Compilation failed",
          status: "error",
          details: stderr || `Process exited with code ${exitCode}`,
          logs: stderr ? stderr.split("\n").filter((l) => l.trim()) : [],
        });
      }

      // Check if wasm exists
      const wasmPath = path.join(
        tempDir,
        "target",
        "wasm32-unknown-unknown",
        "release",
        "soroban_contract.wasm",
      );
      try {
        const fileStats = await fs.stat(wasmPath);
        // It's built successfully
        await cleanUp();
        return res.json({
          success: true,
          status: "success",
          message: "Contract compiled successfully",
          logs: (stdout + (stderr ? "\n" + stderr : ""))
            .split("\n")
            .filter((l) => l.trim()),
          artifact: {
            name: "soroban_contract.wasm",
            sizeBytes: fileStats.size,
            createdAt: fileStats.birthtime,
          },
        });
      } catch (e) {
        await cleanUp();
        return res.status(500).json({
          error: "WASM file not generated",
          status: "error",
          details: stderr || e.message,
          logs: stderr ? stderr.split("\n").filter((l) => l.trim()) : [],
        });
      }
    });
  } catch (err) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {}
    res
      .status(500)
      .json({ error: "Internal server error", details: err.message });
  }
});

export default router;
