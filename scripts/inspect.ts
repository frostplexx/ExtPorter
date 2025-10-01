#!/usr/bin/env ts-node

import dotenv from "dotenv";
import { Database } from "../migrator/features/database/db_manager";
import { Extension } from "../migrator/types/extension";
import { spawn } from "child_process";
import { exit } from "process";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
dotenv.config();

async function main() {
  if (!process.env.OUTPUT_DIR) {
    throw new Error("OUTPUT_DIR not set");
  }
  if (!process.env.INPUT_DIR) {
    throw new Error("INPUT_DIR not set");
  }

  await Database.shared.init();

  const args = process.argv.slice(2);
  const extensionId = args[0];

  if (!extensionId) {
    console.log("Usage: yarn scripts:inspect <extension id (mv2 or mv3)>");
    console.log("Example: yarn scripts:inspect abcdef123456");
    exit(1);
  }

  console.log(`Looking for extension with ID: ${extensionId}`);

  // Try to find the extension in the database
  let dbExtension = await Database.shared.findExtension({ id: extensionId });

  // If not found by MV2 ID, try MV3 ID
  if (!dbExtension) {
    dbExtension = await Database.shared.findExtension({
      mv3_extension_id: extensionId,
    });
  }

  if (!dbExtension) {
    console.log(`Extension with ID ${extensionId} not found in database`);
    exit(1);
  }

  const mv2Extension: Extension = {
    id: dbExtension.id,
    name: dbExtension.name,
    manifest_v2_path: dbExtension.manifest_v2_path,
    manifest: dbExtension.manifest,
    files: dbExtension.files || [],
    isNewTabExtension: dbExtension.isNewTabExtension,
    mv3_extension_id: dbExtension.mv3_extension_id,
  };

  console.log(
    `Found extension: ${mv2Extension.name} (MV2: ${mv2Extension.id})`,
  );
  console.log(`Debug - manifest_v2_path: ${mv2Extension.manifest_v2_path}`);

  // Get MV2 extension directory from manifest_v2_path
  let mv2ExtensionPath: string | null = null;
  if (mv2Extension.manifest_v2_path) {
    // Check if manifest_v2_path points to manifest.json file or directory
    let mv2Path: string;
    if (mv2Extension.manifest_v2_path.endsWith("manifest.json")) {
      mv2Path = path.dirname(mv2Extension.manifest_v2_path);
    } else {
      // Assume it's already a directory path
      mv2Path = mv2Extension.manifest_v2_path;
    }

    if (fs.existsSync(mv2Path)) {
      mv2ExtensionPath = mv2Path;
      console.log(`Found MV2 extension at: ${mv2Path}`);
    } else {
      console.log(`MV2 extension directory not found at: ${mv2Path}`);
    }
  } else {
    console.log("No manifest_v2_path found for MV2 extension");
  }

  // Get MV3 extension directory from manifest_v3_path or fallback to OUTPUT_DIR
  let mv3ExtensionPath: string | null = null;
  console.log(`Debug - manifest_v3_path: ${mv2Extension.manifest_v3_path}`);

  if (mv2Extension.manifest_v3_path) {
    const mv3Path = path.dirname(mv2Extension.manifest_v3_path);
    if (fs.existsSync(mv3Path)) {
      mv3ExtensionPath = mv3Path;
      console.log(`Found MV3 extension at: ${mv3Path}`);
    } else {
      console.log(`MV3 extension directory not found at: ${mv3Path}`);
    }
  } else if (mv2Extension.mv3_extension_id) {
    // Fallback to OUTPUT_DIR for backward compatibility
    const mv3Path = `${process.env.OUTPUT_DIR}/${mv2Extension.mv3_extension_id}`;
    if (fs.existsSync(mv3Path)) {
      mv3ExtensionPath = mv3Path;
      console.log(`Found MV3 extension at: ${mv3Path} (fallback)`);
    } else {
      console.log(`MV3 extension directory not found at: ${mv3Path}`);
    }
  } else {
    console.log("No MV3 version available for this extension");
  }

  if (!mv2ExtensionPath && !mv3ExtensionPath) {
    console.log("No extension files found in either INPUT_DIR or OUTPUT_DIR");
    exit(1);
  }

  // Open Kitty with split panes
  await openInKitty(mv2ExtensionPath, mv3ExtensionPath, mv2Extension);

  await Database.shared.close();
}

async function openInKitty(
  mv2Path: string | null,
  mv3Path: string | null,
  extension: Extension,
) {
  const extensionName = extension.name || "Unknown Extension";

  try {
    if (mv2Path && mv3Path) {
      // Both versions available - create split view
      console.log(
        `Opening Kitty with MV2 (${extension.id}) on left and MV3 (${extension.mv3_extension_id}) on right`,
      );

      // Step 1: Create new tab with MV2
      const newTab = spawn(
        "kitten",
        [
          "@",
          "launch",
          "--type=tab",
          "--tab-title",
          `${extensionName} (MV2 ↔ MV3)`,
          "--cwd",
          mv2Path,
          "--title",
          `MV2: ${extension.id}`,
        ],
        {
          stdio: "pipe",
        },
      );

      let tabOutput = "";
      newTab.stdout.on("data", (data) => {
        tabOutput += data.toString();
      });

      await new Promise((resolve, reject) => {
        newTab.on("close", (code) => {
          if (code === 0) {
            resolve(tabOutput.trim());
          } else {
            reject(new Error(`Failed to create new tab, exit code: ${code}`));
          }
        });
        newTab.on("error", reject);
      });

      // Step 2: Create second window in the same tab with split layout
      const newWindow = spawn(
        "kitten",
        [
          "@",
          "launch",
          "--location",
          "vsplit",
          "--cwd",
          mv3Path,
          "--title",
          `MV3: ${extension.mv3_extension_id}`,
        ],
        {
          stdio: "inherit",
        },
      );

      newWindow.on("error", (error) => {
        if (error.message.includes("ENOENT")) {
          console.error(
            "Error: kitten command not found. Please install Kitty terminal.",
          );
          console.error("Visit: https://sw.kovidgoyal.net/kitty/");
        } else {
          console.error("Error creating split window:", error.message);
        }
      });
    } else if (mv2Path) {
      // Only MV2 version available
      console.log(`Opening Kitty with MV2 version only (${extension.id})`);

      const kitty = spawn(
        "kitten",
        [
          "@",
          "launch",
          "--type=tab",
          "--tab-title",
          `${extensionName} (MV2 only)`,
          "--cwd",
          mv2Path,
          "--title",
          `MV2: ${extension.id}`,
        ],
        {
          stdio: "inherit",
        },
      );

      kitty.on("error", (error) => {
        if (error.message.includes("ENOENT")) {
          console.error(
            "Error: kitten command not found. Please install Kitty terminal.",
          );
          console.error("Visit: https://sw.kovidgoyal.net/kitty/");
        } else {
          console.error("Error opening Kitty:", error.message);
        }
      });
    } else if (mv3Path) {
      // Only MV3 version available
      console.log(
        `Opening Kitty with MV3 version only (${extension.mv3_extension_id})`,
      );

      const kitty = spawn(
        "kitten",
        [
          "@",
          "launch",
          "--type=tab",
          "--tab-title",
          `${extensionName} (MV3 only)`,
          "--cwd",
          mv3Path,
          "--title",
          `MV3: ${extension.mv3_extension_id}`,
        ],
        {
          stdio: "inherit",
        },
      );

      kitty.on("error", (error) => {
        if (error.message.includes("ENOENT")) {
          console.error(
            "Error: kitten command not found. Please install Kitty terminal.",
          );
          console.error("Visit: https://sw.kovidgoyal.net/kitty/");
        } else {
          console.error("Error opening Kitty:", error.message);
        }
      });
    }
  } catch (error) {
    console.error("Failed to open Kitty:", error);

    // Fallback: print paths for manual navigation
    console.log("\nFallback - Navigate to these directories manually:");
    if (mv2Path) {
      console.log(`MV2: ${mv2Path}`);
    }
    if (mv3Path) {
      console.log(`MV3: ${mv3Path}`);
    }
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
