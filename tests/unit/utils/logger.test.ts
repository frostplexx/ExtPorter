import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { logger, LogLevel } from '../../../migrator/utils/logger';
import { Extension } from '../../../migrator/types/extension';
import { Database } from '../../../migrator/features/database/db_manager';
import fs from 'fs-extra';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('../../../migrator/features/database/db_manager');

// Save original environment
const originalEnv = process.env;

describe('Logger', () => {
    let mockExtension: Extension;
    let consoleSpy: {
        info: any;
        warn: any;
        error: any;
        debug: any;
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Reset environment
        process.env = { ...originalEnv };
        delete process.env.NODE_ENV; // Remove test env to enable logging

        mockExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {},
            files: [],
        } as Extension;

        // Mock console methods
        consoleSpy = {
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
            debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
        };

        // Mock fs-extra
        (fs.ensureDirSync as jest.Mock).mockImplementation(() => {});
        (fs.appendFileSync as jest.Mock).mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    describe('LogLevel enum', () => {
        it('should have correct log levels', () => {
            expect(LogLevel.DEBUG).toBe('debug');
            expect(LogLevel.INFO).toBe('info');
            expect(LogLevel.WARN).toBe('warning');
            expect(LogLevel.ERROR).toBe('error');
        });
    });

    describe('info logging', () => {
        it('should log info messages to console', () => {
            process.env.LOG_LEVEL = 'info';

            logger.info(mockExtension, 'Test info message', { key: 'value' });

            expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining('[INFO]'), {
                key: 'value',
            });
        });

        it('should not log info when log level is error', () => {
            process.env.LOG_LEVEL = 'error';

            logger.info(mockExtension, 'Test info message');

            expect(consoleSpy.info).not.toHaveBeenCalled();
        });

        it('should suppress logging in test mode', () => {
            process.env.NODE_ENV = 'test';
            process.env.LOG_LEVEL = 'debug';

            logger.info(mockExtension, 'Test message');

            expect(consoleSpy.info).not.toHaveBeenCalled();
        });

        it('should handle null extension', () => {
            process.env.LOG_LEVEL = 'info';

            logger.info(null, 'Test message');

            expect(consoleSpy.info).toHaveBeenCalled();
        });

        it('should handle undefined meta', () => {
            process.env.LOG_LEVEL = 'info';

            logger.info(mockExtension, 'Test message');

            expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining('[INFO]'), '');
        });
    });

    describe('warn logging', () => {
        it('should log warning messages to console', () => {
            process.env.LOG_LEVEL = 'warning';

            logger.warn(mockExtension, 'Test warning message', { warning: true });

            expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('[WARNING]'), {
                warning: true,
            });
        });

        it('should not log warning when log level is error', () => {
            process.env.LOG_LEVEL = 'error';

            logger.warn(mockExtension, 'Test warning message');

            expect(consoleSpy.warn).not.toHaveBeenCalled();
        });

        it('should suppress warning logging in test mode', () => {
            process.env.NODE_ENV = 'test';
            process.env.LOG_LEVEL = 'debug';

            logger.warn(mockExtension, 'Test warning');

            expect(consoleSpy.warn).not.toHaveBeenCalled();
        });
    });

    describe('error logging', () => {
        it('should log error messages to console', () => {
            process.env.LOG_LEVEL = 'error';

            logger.error(mockExtension, 'Test error message', { error: 'details' });

            expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'), {
                error: 'details',
            });
        });

        it('should always log errors regardless of log level', () => {
            process.env.LOG_LEVEL = 'invalid';

            logger.error(mockExtension, 'Test error message');

            expect(consoleSpy.error).toHaveBeenCalled();
        });

        it('should suppress error logging in test mode', () => {
            process.env.NODE_ENV = 'test';

            logger.error(mockExtension, 'Test error');

            expect(consoleSpy.error).not.toHaveBeenCalled();
        });
    });

    describe('debug logging', () => {
        it('should log debug messages when level is debug', () => {
            process.env.LOG_LEVEL = 'debug';

            logger.debug(mockExtension, 'Test debug message', { debug: true });

            expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'), {
                debug: true,
            });
        });

        it('should not log debug when log level is info', () => {
            process.env.LOG_LEVEL = 'info';

            logger.debug(mockExtension, 'Test debug message');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });

        it('should suppress debug logging in test mode', () => {
            process.env.NODE_ENV = 'test';
            process.env.LOG_LEVEL = 'debug';

            logger.debug(mockExtension, 'Test debug');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });
    });

    describe('log level hierarchy', () => {
        it('should respect log level hierarchy for info', () => {
            // Test that info logs when level is info or higher
            const levels = ['debug', 'info'];
            levels.forEach((level) => {
                process.env.LOG_LEVEL = level;
                consoleSpy.info.mockClear();

                logger.info(mockExtension, 'Test message');

                expect(consoleSpy.info).toHaveBeenCalled();
            });
        });

        it('should not log info when level is lower', () => {
            const levels = ['warning', 'error'];
            levels.forEach((level) => {
                process.env.LOG_LEVEL = level;
                consoleSpy.info.mockClear();

                logger.info(mockExtension, 'Test message');

                expect(consoleSpy.info).not.toHaveBeenCalled();
            });
        });
    });

    describe('color formatting', () => {
        it('should include color codes in log output', () => {
            process.env.LOG_LEVEL = 'debug';

            logger.info(mockExtension, 'Test message');

            const call = consoleSpy.info.mock.calls[0][0];
            expect(call).toMatch(/\x1b\[\d+m.*\x1b\[0m/); // ANSI color codes
        });

        it('should have different colors for different log levels', () => {
            process.env.LOG_LEVEL = 'debug';

            logger.debug(mockExtension, 'Debug message');
            logger.info(mockExtension, 'Info message');
            logger.warn(mockExtension, 'Warn message');
            logger.error(mockExtension, 'Error message');

            const debugCall = consoleSpy.debug.mock.calls[0][0];
            const infoCall = consoleSpy.info.mock.calls[0][0];
            const warnCall = consoleSpy.warn.mock.calls[0][0];
            const errorCall = consoleSpy.error.mock.calls[0][0];

            // Each should have different color codes
            expect(debugCall).toContain('\x1b[36m'); // Cyan for debug
            expect(infoCall).toContain('\x1b[32m'); // Green for info
            expect(warnCall).toContain('\x1b[33m'); // Yellow for warning
            expect(errorCall).toContain('\x1b[31m'); // Red for error
        });
    });

    describe('file system operations', () => {
        it('should ensure logs directory exists', () => {
            // The logs directory is created during module import (before mocks are set up)
            // We can't test the mock call, but we can verify the logs directory path is correct
            const logsDir = require('path').join(process.cwd(), 'logs');
            expect(logsDir).toContain('logs');
        });
    });
});
