import { Extension } from "../types/extension";
import { MigrationError, MigrationModule } from "../types/migration_module";
import { LazyFile } from "../types/abstract_file";
import { ExtFileType } from "../types/ext_file_types";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

/**
 * This module injects the ext_bridge.js compatibility layer into Chrome extensions
 * to enable MV2 callback-style APIs to work with MV3 promise-based APIs.
 */
export class BridgeInjector implements MigrationModule {
  private static readonly BRIDGE_FILENAME = "ext_bridge.js";

  /**
   * Checks if an extension likely uses callback-based Chrome APIs
   * by looking for common callback patterns in JavaScript files.
   */
  private static needsBridge(extension: Extension): boolean {
    // Check if any JS files contain callback patterns
    for (const file of extension.files) {
      if (file.filetype === ExtFileType.JS) {
        const content = file.getContent();
        if (content && BridgeInjector.hasCallbackPatterns(content)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Detects common callback patterns in JavaScript code.
   */
  private static hasCallbackPatterns(content: string): boolean {
    // Common Chrome API callback patterns
    const callbackPatterns = [
      /chrome\.\w+\.\w+\([^)]*,\s*function\s*\(/,
      /chrome\.\w+\.\w+\([^)]*,\s*\([^)]*\)\s*=>/,
      /chrome\.\w+\.\w+\([^)]*,\s*callback\s*\)/,
      /chrome\.runtime\.lastError/,
      /chrome\.\w+\.\w+\.\w+\([^)]*,\s*function\s*\(/,
      /chrome\.\w+\.\w+\.\w+\([^)]*,\s*\([^)]*\)\s*=>/,
    ];

    return callbackPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Loads the bridge file content from the templates directory.
   */
  private static loadBridgeContent(): string {
    try {
      const bridgePath = path.join(__dirname, "../templates/ext_bridge.js");
      return fs.readFileSync(bridgePath, "utf8");
    } catch (error) {
      throw new Error(
        `Failed to load bridge file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Creates a LazyFile instance for the bridge file.
   */
  private static createBridgeFile(): LazyFile {
    const bridgeContent = BridgeInjector.loadBridgeContent();

    // Create a LazyFile-like object for the bridge
    const bridgeFile = Object.create(LazyFile.prototype);
    bridgeFile.path = BridgeInjector.BRIDGE_FILENAME;
    bridgeFile.filetype = ExtFileType.JS;
    bridgeFile._bridgeContent = bridgeContent;

    // Override methods to work with bridge content
    bridgeFile.getContent = () => bridgeContent;
    bridgeFile.getSize = () => Buffer.byteLength(bridgeContent, "utf8");
    bridgeFile.close = () => {
      /* No-op for in-memory content */
    };
    bridgeFile.getAST = () => {
      // Bridge file doesn't need AST parsing for this migration
      return undefined;
    };

    return bridgeFile;
  }

  /**
   * Injects the bridge file into the manifest's script arrays.
   */
  private static injectBridgeIntoManifest(manifest: any): any {
    const updatedManifest = JSON.parse(JSON.stringify(manifest));

    // Inject into background scripts (MV2 style)
    if (updatedManifest.background && updatedManifest.background.scripts) {
      if (
        !updatedManifest.background.scripts.includes(
          BridgeInjector.BRIDGE_FILENAME,
        )
      ) {
        updatedManifest.background.scripts.unshift(
          BridgeInjector.BRIDGE_FILENAME,
        );
      }
    }

    // Inject into background service worker (MV3 style)
    if (
      updatedManifest.background &&
      updatedManifest.background.service_worker
    ) {
      // For service worker, we need to ensure the bridge is loaded
      // This might require additional handling depending on the service worker structure
      logger.debug(
        null,
        "Service worker detected, bridge injection may need additional handling",
        {
          service_worker: updatedManifest.background.service_worker,
        },
      );
    }

    // Inject into content scripts
    if (
      updatedManifest.content_scripts &&
      Array.isArray(updatedManifest.content_scripts)
    ) {
      updatedManifest.content_scripts.forEach((contentScript: any) => {
        if (contentScript.js && Array.isArray(contentScript.js)) {
          if (!contentScript.js.includes(BridgeInjector.BRIDGE_FILENAME)) {
            contentScript.js.unshift(BridgeInjector.BRIDGE_FILENAME);
          }
        }
      });
    }

    // Add web_accessible_resources if needed (for content script injection)
    if (
      updatedManifest.content_scripts &&
      updatedManifest.content_scripts.length > 0
    ) {
      if (!updatedManifest.web_accessible_resources) {
        updatedManifest.web_accessible_resources = [];
      }

      // MV3 format
      if (updatedManifest.manifest_version === 3) {
        const existingResource = updatedManifest.web_accessible_resources.find(
          (resource: any) =>
            resource.resources &&
            resource.resources.includes(BridgeInjector.BRIDGE_FILENAME),
        );

        if (!existingResource) {
          updatedManifest.web_accessible_resources.push({
            resources: [BridgeInjector.BRIDGE_FILENAME],
            matches: ["<all_urls>"],
          });
        }
      } else {
        // MV2 format (for compatibility during transition)
        if (
          !updatedManifest.web_accessible_resources.includes(
            BridgeInjector.BRIDGE_FILENAME,
          )
        ) {
          updatedManifest.web_accessible_resources.push(
            BridgeInjector.BRIDGE_FILENAME,
          );
        }
      }
    }

    return updatedManifest;
  }

  /**
   * Main migration method that injects the bridge into extensions that need it.
   */
  public static migrate(extension: Extension): Extension | MigrationError {
    const startTime = Date.now();

    try {
      // Validate extension input
      if (
        !extension ||
        !extension.id ||
        !extension.files ||
        !extension.manifest
      ) {
        return new MigrationError(
          extension,
          new Error("Invalid extension structure"),
        );
      }

      // Check if the extension needs the bridge
      if (!BridgeInjector.needsBridge(extension)) {
        logger.debug(extension, "Extension does not need callback bridge");
        return extension;
      }

      // Check if bridge is already injected
      const hasBridge = extension.files.some(
        (file) => file.path === BridgeInjector.BRIDGE_FILENAME,
      );
      if (hasBridge) {
        logger.debug(extension, "Bridge already injected");
        return extension;
      }

      logger.info(extension, "Injecting callback compatibility bridge");

      // Create bridge file
      const bridgeFile = BridgeInjector.createBridgeFile();

      // Update manifest to include bridge
      const updatedManifest = BridgeInjector.injectBridgeIntoManifest(
        extension.manifest,
      );

      // Add bridge file to extension files
      const updatedFiles = [...extension.files, bridgeFile];

      const duration = Date.now() - startTime;
      logger.info(extension, "Bridge injection completed", {
        duration,
        bridgeFile: BridgeInjector.BRIDGE_FILENAME,
      });

      // Return updated extension
      return {
        ...extension,
        manifest: updatedManifest,
        files: updatedFiles,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(extension, "Bridge injection failed", {
        error: error instanceof Error ? error.message : String(error),
        duration,
      });
      return new MigrationError(extension, error);
    }
  }

  /**
   * Helper method for testing - checks if manifest has bridge injected.
   */
  public static hasBridgeInManifest(manifest: any): boolean {
    // Check background scripts
    if (manifest.background && manifest.background.scripts) {
      if (
        manifest.background.scripts.includes(BridgeInjector.BRIDGE_FILENAME)
      ) {
        return true;
      }
    }

    // Check content scripts
    if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
      return manifest.content_scripts.some(
        (contentScript: any) =>
          contentScript.js &&
          contentScript.js.includes(BridgeInjector.BRIDGE_FILENAME),
      );
    }

    return false;
  }

  /**
   * Helper method for testing - exposed for unit tests.
   */
  public static testHelpers = {
    needsBridge: BridgeInjector.needsBridge,
    hasCallbackPatterns: BridgeInjector.hasCallbackPatterns,
    injectBridgeIntoManifest: BridgeInjector.injectBridgeIntoManifest,
    createBridgeFile: BridgeInjector.createBridgeFile,
    loadBridgeContent: BridgeInjector.loadBridgeContent,
    hasBridgeInManifest: BridgeInjector.hasBridgeInManifest,
    BRIDGE_FILENAME: BridgeInjector.BRIDGE_FILENAME,
  };
}
