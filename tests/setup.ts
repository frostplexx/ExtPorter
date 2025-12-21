import * as path from 'path';
import * as fs from 'fs-extra';
import dotenv from 'dotenv';

// Set up test environment
process.env.NODE_ENV = 'test';
process.env.TEST_OUTPUT_DIR = path.join(__dirname, 'temp');

// Detect and prepare a mongodb-memory-server if available. If not available, register our local
// mongodb mock so tests that import 'mongodb' will receive the mock implementation.
let MemoryServer: any = null;
try {
    const mod = require('mongodb-memory-server');
    MemoryServer = mod.MongoMemoryServer || mod.default?.MongoMemoryServer || mod;
} catch (err) {
    if (typeof jest !== 'undefined' && jest.doMock) {
        // Register the mock implementation for the 'mongodb' module synchronously.
        // We use doMock (not the hoisted mock) so the decision is made at module-load time
        // and test modules that import 'mongodb' will get the mock implementation.
        jest.doMock('mongodb', () => require('./unit/__mocks__/mongodb'));
    } else {
        // Ensure there's a safe fallback URI even if jest isn't available for some reason.
        process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    }
}

// Global setup
beforeAll(async () => {
    // Load environment variables once at application startup
    const originalLog = console.log;
    console.log = () => {}; // suppress logs
    dotenv.config();
    console.log = originalLog; // restore

    // Ensure DB name env vars are present
    process.env.DB_NAME = process.env.DB_NAME || 'test_db';
    process.env.MONGO_DATABASE = process.env.MONGO_DATABASE || process.env.DB_NAME;

    // If MONGODB_URI is not set, prefer to start an in-memory MongoDB for tests.
    if (!process.env.MONGODB_URI) {
        if (MemoryServer) {
            try {
                // Start an in-memory mongod instance
                const mongod = await MemoryServer.create();
                (global as any).__MONGOD__ = mongod;

                // getUri() may or may not include a DB name depending on version;
                // ensure the returned URI includes our DB_NAME when possible.
                let uri = typeof mongod.getUri === 'function' ? mongod.getUri() : String((mongod as any).uri || '');
                if (process.env.DB_NAME && uri && !uri.includes(`/${process.env.DB_NAME}`)) {
                    uri = uri.endsWith('/') ? `${uri}${process.env.DB_NAME}` : `${uri}/${process.env.DB_NAME}`;
                }

                process.env.MONGODB_URI = uri;
                process.env.MONGO_DATABASE = process.env.MONGO_DATABASE || process.env.DB_NAME;
                console.log('Started mongodb-memory-server for tests:', process.env.MONGODB_URI);
            } catch (err) {
                console.warn('Could not start mongodb-memory-server for tests, falling back to mock/local MongoDB:', err);
                // Fall back to a safe default URI; local/mock implementation should handle operations.
                process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
                if (typeof jest !== 'undefined' && jest.doMock) {
                    jest.doMock('mongodb', () => require('./unit/__mocks__/mongodb'));
                }
            }
        } else {
            // No memory server available - set a safe default URI and rely on the mock registered above.
            process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
            process.env.DB_NAME = process.env.DB_NAME || 'test_db';
            
        }
    }

    const testOutputDir = process.env.TEST_OUTPUT_DIR!;
    if (fs.existsSync(testOutputDir)) {
        fs.removeSync(testOutputDir);
    }
    fs.ensureDirSync(testOutputDir);
});

// Clean up after all tests
afterAll(async () => {
    // Stop mongodb-memory-server if it was started
    const mongod: any = (global as any).__MONGOD__;
    if (mongod && typeof mongod.stop === 'function') {
        try {
            await mongod.stop();
            console.log('Stopped mongodb-memory-server');
        } catch (e) {
            console.warn('Failed to stop mongodb-memory-server:', e);
        }
    }

    const testOutputDir = process.env.TEST_OUTPUT_DIR!;
    if (fs.existsSync(testOutputDir)) {
        try {
            fs.removeSync(testOutputDir);
        } catch (error) {
            // Ignore cleanup errors
            console.warn('Failed to clean up test directory:', error);
        }
    }
});

// Global test timeout
jest.setTimeout(30000);
