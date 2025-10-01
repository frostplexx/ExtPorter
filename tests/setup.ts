import * as path from "path";
import * as fs from "fs-extra";
import dotenv from "dotenv";

// Set up test environment
process.env.NODE_ENV = "test";
process.env.TEST_OUTPUT_DIR = path.join(__dirname, "temp");

// Global setup
beforeAll(() => {
  // Load environment variables once at application startup
  const originalLog = console.log;
  console.log = () => {}; // suppress logs
  dotenv.config();
  console.log = originalLog; // restore
  const testOutputDir = process.env.TEST_OUTPUT_DIR!;
  if (fs.existsSync(testOutputDir)) {
    fs.removeSync(testOutputDir);
  }
  fs.ensureDirSync(testOutputDir);
});

// Clean up after all tests
afterAll(() => {
  const testOutputDir = process.env.TEST_OUTPUT_DIR!;
  if (fs.existsSync(testOutputDir)) {
    try {
      fs.removeSync(testOutputDir);
    } catch (error) {
      // Ignore cleanup errors
      console.warn("Failed to clean up test directory:", error);
    }
  }
});

// Global test timeout
jest.setTimeout(30000);
