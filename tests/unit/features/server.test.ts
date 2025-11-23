import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { MigrationServer } from '../../../migrator/features/server/app';
import { Database } from '../../../migrator/features/database/db_manager';
import WebSocket from 'ws';

describe('MigrationServer Database API', () => {
    let server: MigrationServer;
    let ws: WebSocket;
    const testGlobals = {
        extensionsPath: '/tmp/test-extensions',
        outputDir: '/tmp/test-output',
    };

    beforeAll(async () => {
        // Skip if MongoDB is not available
        if (!process.env.MONGODB_URI) {
            console.warn('Skipping server tests - MongoDB not available');
            return;
        }

        // Initialize database
        await Database.shared.init();

        // Start server
        server = new MigrationServer(testGlobals);
        server.start();

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 500));
    });

    afterAll(async () => {
        if (ws) {
            ws.close();
        }
        if (server) {
            server.close();
        }
        if (Database.shared) {
            await Database.shared.close();
        }
    });

    it('should connect to WebSocket server', (done) => {
        if (!process.env.MONGODB_URI) {
            pending('MongoDB not available for testing');
            return;
        }

        ws = new WebSocket('ws://localhost:8080');

        ws.on('open', () => {
            expect(ws.readyState).toBe(WebSocket.OPEN);
            done();
        });

        ws.on('error', (error) => {
            fail(`WebSocket connection error: ${error.message}`);
        });
    }, 10000);

    it('should respond to getExtensions query', (done) => {
        if (!process.env.MONGODB_URI) {
            pending('MongoDB not available for testing');
            return;
        }

        ws = new WebSocket('ws://localhost:8080');

        ws.on('open', () => {
            const request = {
                type: 'db_query',
                id: 1,
                method: 'getExtensions',
                params: {},
            };

            ws.send(JSON.stringify(request));
        });

        ws.on('message', (data) => {
            const message = data.toString();

            // Skip non-JSON messages
            if (!message.startsWith('{')) {
                return;
            }

            try {
                const response = JSON.parse(message);

                if (response.type === 'db_response' && response.id === 1) {
                    expect(response.result).toBeDefined();
                    expect(Array.isArray(response.result)).toBe(true);
                    done();
                }
            } catch (error) {
                // Ignore non-JSON messages
            }
        });

        ws.on('error', (error) => {
            fail(`WebSocket error: ${error.message}`);
        });
    }, 10000);

    it('should respond to getCollections query', (done) => {
        if (!process.env.MONGODB_URI) {
            pending('MongoDB not available for testing');
            return;
        }

        ws = new WebSocket('ws://localhost:8080');

        ws.on('open', () => {
            const request = {
                type: 'db_query',
                id: 2,
                method: 'getCollections',
                params: {},
            };

            ws.send(JSON.stringify(request));
        });

        ws.on('message', (data) => {
            const message = data.toString();

            // Skip non-JSON messages
            if (!message.startsWith('{')) {
                return;
            }

            try {
                const response = JSON.parse(message);

                if (response.type === 'db_response' && response.id === 2) {
                    expect(response.result).toBeDefined();
                    expect(Array.isArray(response.result)).toBe(true);
                    // Each collection should have name and count
                    if (response.result.length > 0) {
                        expect(response.result[0].name).toBeDefined();
                        expect(response.result[0].count).toBeDefined();
                    }
                    done();
                }
            } catch (error) {
                // Ignore non-JSON messages
            }
        });

        ws.on('error', (error) => {
            fail(`WebSocket error: ${error.message}`);
        });
    }, 10000);

    it('should handle invalid query method', (done) => {
        if (!process.env.MONGODB_URI) {
            pending('MongoDB not available for testing');
            return;
        }

        ws = new WebSocket('ws://localhost:8080');

        ws.on('open', () => {
            const request = {
                type: 'db_query',
                id: 3,
                method: 'invalidMethod',
                params: {},
            };

            ws.send(JSON.stringify(request));
        });

        ws.on('message', (data) => {
            const message = data.toString();

            // Skip non-JSON messages
            if (!message.startsWith('{')) {
                return;
            }

            try {
                const response = JSON.parse(message);

                if (response.type === 'db_response' && response.id === 3) {
                    expect(response.error).toBeDefined();
                    expect(response.error).toContain('Unknown database method');
                    done();
                }
            } catch (error) {
                // Ignore non-JSON messages
            }
        });

        ws.on('error', (error) => {
            fail(`WebSocket error: ${error.message}`);
        });
    }, 10000);
});
