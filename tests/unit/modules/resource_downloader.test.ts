import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "path";
import { ResourceDownloader } from "../../../migrator/modules/resource_downloader";
import { Extension } from "../../../migrator/types/extension";
import { LazyFile } from "../../../migrator/types/abstract_file";
import { ExtFileType } from "../../../migrator/types/ext_file_types";
import { MigrationError } from "../../../migrator/types/migration_module";

// Mock globals
jest.mock("../../../migrator/index", () => ({
  globals: {
    outputDir: process.env.TEST_OUTPUT_DIR + "/resource_downloader_test",
    extensionsPath: "/test/extensions",
  },
}));

describe("ResourceDownloader", () => {
  const testDir = path.join(
    process.env.TEST_OUTPUT_DIR!,
    "resource_downloader_test",
  );

  beforeEach(() => {
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  function createTestExtension(
    name: string,
    manifest: any,
    files: Array<{ name: string; content: string; type: ExtFileType }>,
  ): Extension {
    const extensionDir = path.join(testDir, name);
    fs.ensureDirSync(extensionDir);

    const lazyFiles: LazyFile[] = [];

    files.forEach((file) => {
      const filePath = path.join(extensionDir, file.name);
      fs.ensureDirSync(path.dirname(filePath));
      fs.writeFileSync(filePath, file.content);
      lazyFiles.push(new LazyFile(file.name, filePath, file.type));
    });

    return {
      id: `test-${name}`,
      mv3_extension_id: `test-${name}`,
      name: name,
      manifest_v2_path: extensionDir,
      manifest: manifest,
      files: lazyFiles,
    };
  }

  describe("migrate", () => {
    it("should return extension unchanged when no remote resources found", () => {
      const extension = createTestExtension(
        "no-remote",
        {
          name: "No Remote Extension",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "content.js",
            content: 'console.log("local");',
            type: ExtFileType.JS,
          },
          {
            name: "style.css",
            content: "body { color: red; }",
            type: ExtFileType.CSS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        expect(result.name).toBe(extension.name);
        expect(result.files).toHaveLength(2);
      }

      extension.files.forEach((file) => file.close());
    });

    it("should find and process remote resources in JavaScript files", () => {
      const extension = createTestExtension(
        "js-remote",
        {
          name: "JS Remote Extension",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "content.js",
            content: `
            const bootstrapJs = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js';
            const jqueryUrl = 'https://code.jquery.com/jquery-3.7.1.min.js';
            fetch(bootstrapJs);
          `,
            type: ExtFileType.JS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Check that remote resources directory was created
        const remoteResourcesDir = path.join(
          testDir,
          extension.mv3_extension_id!,
          "remote_resources",
        );
        expect(fs.existsSync(remoteResourcesDir)).toBe(true);

        // Check that files were added
        expect(result.files.length).toBeGreaterThan(extension.files.length);

        // Check that URLs were replaced in content
        const contentFile = result.files.find((f) => f.path === "content.js");
        expect(contentFile).toBeDefined();
        if (contentFile) {
          const content = contentFile.getContent();
          expect(content).toContain("remote_resources/");
          expect(content).not.toContain("https://cdn.jsdelivr.net/");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should find and process remote resources in CSS files", () => {
      const extension = createTestExtension(
        "css-remote",
        {
          name: "CSS Remote Extension",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "style.css",
            content: `
            @import url('https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css');

            body {
              background-image: url('https://kit.fontawesome.com/55bb5526ef.js');
              font-family: 'Inter', sans-serif;
            }
          `,
            type: ExtFileType.CSS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const contentFile = result.files.find((f) => f.path === "style.css");
        expect(contentFile).toBeDefined();
        if (contentFile) {
          const content = contentFile.getContent();
          expect(content).toContain("remote_resources/");
          expect(content).not.toContain("https://cdn.jsdelivr.net/");
          expect(content).not.toContain("https://kit.fontawesome.com/");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should find and process remote resources in HTML files", () => {
      const extension = createTestExtension(
        "html-remote",
        {
          name: "HTML Remote Extension",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "popup.html",
            content: `
            <!DOCTYPE html>
            <html>
            <head>
              <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css">
              <script src="https://kit.fontawesome.com/55bb5526ef.js" crossorigin="anonymous"></script>
            </head>
            <body>
              <script migrator="https://code.jquery.com/jquery-3.7.1.min.js"></script>
            </body>
            </html>
          `,
            type: ExtFileType.HTML,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const contentFile = result.files.find((f) => f.path === "popup.html");
        expect(contentFile).toBeDefined();
        if (contentFile) {
          const content = contentFile.getContent();
          expect(content).toContain("remote_resources/");
          expect(content).not.toContain("https://cdn.jsdelivr.net/");
          expect(content).not.toContain("https://kit.fontawesome.com/");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should find remote resources in manifest", () => {
      const extension = createTestExtension(
        "manifest-remote",
        {
          name: "Manifest Remote Extension",
          version: "1.0",
          manifest_version: 2,
          web_accessible_resources: [
            "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css",
            "https://code.jquery.com/jquery-3.7.1.min.js",
          ],
        },
        [],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Check that manifest was updated
        const webAccessibleResources = result.manifest.web_accessible_resources;
        expect(webAccessibleResources).toBeDefined();
        if (Array.isArray(webAccessibleResources)) {
          const resourceStrings = webAccessibleResources.join(" ");
          expect(resourceStrings).toContain("remote_resources/");
          expect(resourceStrings).not.toContain("https://cdn.jsdelivr.net/");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should handle multiple remote resources correctly", () => {
      const extension = createTestExtension(
        "multiple-remote",
        {
          name: "Multiple Remote Extension",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "content.js",
            content: `
            const bootstrap = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css';
            const jquery = 'https://code.jquery.com/jquery-3.7.1.min.js';
            const fontawesome = 'https://kit.fontawesome.com/55bb5526ef.js';
            const bootstrapJs = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js';
          `,
            type: ExtFileType.JS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Should have multiple downloaded files
        const downloadedFiles = result.files.filter((f) =>
          f.path.startsWith("remote_resources/"),
        );
        expect(downloadedFiles.length).toBeGreaterThan(0);

        // Check that all URLs were replaced
        const contentFile = result.files.find((f) => f.path === "content.js");
        expect(contentFile).toBeDefined();
        if (contentFile) {
          const content = contentFile.getContent();
          expect(content).not.toContain("https://cdn.jsdelivr.net/");
          expect(content).not.toContain("https://code.jquery.com/");
          expect(content).not.toContain("https://kit.fontawesome.com/");

          // Count occurrences of remote_resources
          const matches = content.match(/remote_resources\//g);
          expect(matches?.length).toBeGreaterThanOrEqual(4);
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should filter out invalid URLs", () => {
      const extension = createTestExtension(
        "invalid-urls",
        {
          name: "Invalid URLs Extension",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "content.js",
            content: `
            const validUrl = 'https://fonts.googleapis.com/css2?family=Roboto';
            const httpUrl = 'http://insecure.com/resource.js'; // Should be filtered
            const localhost = 'https://localhost:3000/api'; // Should be filtered
            const example = 'https://example.com/test.js'; // Should be filtered
            const invalidUrl = 'not-a-url'; // Should be filtered
          `,
            type: ExtFileType.JS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const contentFile = result.files.find((f) => f.path === "content.js");
        expect(contentFile).toBeDefined();
        if (contentFile) {
          const content = contentFile.getContent();
          // Valid URL should be replaced
          expect(content).not.toContain("https://fonts.googleapis.com/");
          // Invalid URLs should remain unchanged
          expect(content).toContain("http://insecure.com/");
          expect(content).toContain("https://localhost:3000/");
          expect(content).toContain("https://example.com/");
          expect(content).toContain("not-a-url");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should create organized directory structure for downloads", () => {
      const extension = createTestExtension(
        "organized-downloads",
        {
          name: "organized-downloads",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "content.js",
            content: `
            const googleFont = 'https://fonts.googleapis.com/css2?family=Roboto';
            const jsdelivr = 'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css';
            const unpkg = 'https://unpkg.com/react@17/umd/react.development.js';
          `,
            type: ExtFileType.JS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const remoteResourcesDir = path.join(
          testDir,
          extension.mv3_extension_id!,
          "remote_resources",
        );

        // Check that remote resources directory exists
        expect(fs.existsSync(remoteResourcesDir)).toBe(true);

        // Check that files exist in the directory
        const resourceFiles = fs.readdirSync(remoteResourcesDir);
        expect(resourceFiles.length).toBeGreaterThan(0);

        // Files should have hash prefixes
        resourceFiles.forEach((file) => {
          expect(file).toMatch(/^[a-f0-9]{8}_/);
        });

        // Should have files for different resource types
        expect(resourceFiles.some((f) => f.endsWith(".css"))).toBe(true);
        expect(resourceFiles.some((f) => f.endsWith(".js"))).toBe(true);
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should handle extensions with no files", () => {
      const extension = createTestExtension(
        "no-files",
        {
          name: "No Files Extension",
          version: "1.0",
          manifest_version: 2,
          web_accessible_resources: [
            "https://fonts.googleapis.com/css2?family=Roboto",
          ],
        },
        [],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        // Should still process manifest resources
        expect(result.files.length).toBeGreaterThan(0);
      }

      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should return MigrationError on serious failures", () => {
      // Create an extension with a null manifest to trigger an error
      const badExtension = {
        id: "bad-extension",
        name: "bad-extension",
        manifest_v2_path: "/bad/path",
        manifest: null as any,
        files: [],
      };

      const result = ResourceDownloader.migrate(badExtension);

      expect(result).toBeInstanceOf(MigrationError);
      if (result instanceof MigrationError) {
        expect(result.extension).toBe(badExtension);
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("URL pattern matching", () => {
    it("should match Google Fonts URLs", () => {
      const extension = createTestExtension(
        "google-fonts",
        {
          name: "Google Fonts Test",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "test.css",
            content: `
            @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap');
            @import url('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2');
          `,
            type: ExtFileType.CSS,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const testFile = result.files.find((f) => f.path === "test.css");
        expect(testFile).toBeDefined();
        if (testFile) {
          const content = testFile.getContent();
          expect(content).not.toContain("fonts.googleapis.com");
          expect(content).not.toContain("fonts.gstatic.com");
          expect(content).toContain("remote_resources/");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });

    it("should match CDN URLs", () => {
      const extension = createTestExtension(
        "cdn-test",
        {
          name: "CDN Test",
          version: "1.0",
          manifest_version: 2,
        },
        [
          {
            name: "test.html",
            content: `
            <script migrator="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
            <script migrator="https://unpkg.com/react@17/umd/react.development.js"></script>
            <script migrator="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
          `,
            type: ExtFileType.HTML,
          },
        ],
      );

      const result = ResourceDownloader.migrate(extension);

      expect(result).not.toBeInstanceOf(MigrationError);
      if (!(result instanceof MigrationError)) {
        const testFile = result.files.find((f) => f.path === "test.html");
        expect(testFile).toBeDefined();
        if (testFile) {
          const content = testFile.getContent();
          expect(content).not.toContain("cdn.jsdelivr.net");
          expect(content).not.toContain("unpkg.com");
          expect(content).not.toContain("cdnjs.cloudflare.com");
          expect(content).toContain("remote_resources/");
        }
      }

      extension.files.forEach((file) => file.close());
      if (!(result instanceof MigrationError)) {
        result.files.forEach((file) => file.close());
      }
    });
  });
});
