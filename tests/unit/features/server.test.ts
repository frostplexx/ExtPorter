import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { MigrationServer } from '../../../migrator/features/server/app';
import { Database } from '../../../migrator/features/database/db_manager';
import WebSocket from 'ws';

describe('MigrationServer Database API', () => {
    let server: MigrationServer;
    let ws: WebSocket;
    let serverStarted = false;
    let testPort: number;
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

        // Initialize database with a short timeout to avoid hanging when Mongo is unreachable
        try {
            await Promise.race([
                Database.shared.init(),
                // new Promise((_, reject) =>
                //     setTimeout(() => reject(new Error('MongoDB connection timeout')), 5000)
                // ),
            ]);
        } catch (error) {
            console.warn('Skipping server tests - DB init failed:', error);
            return;
        }

        // Pick a random available port to avoid EADDRINUSE when tests run in parallel
        testPort = await new Promise<number>((resolve, reject) => {
            const net = require('net');
            const srv = net.createServer();
            srv.listen(0, '127.0.0.1', () => {
                const port = (srv.address() as any).port;
                srv.close((err?: Error) => {
                    if (err) reject(err);
                    else resolve(port);
                });
            });
            srv.on('error', reject);
        });

        // Start server
        server = new MigrationServer(testGlobals, testPort);
        server.start();
        serverStarted = true;

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
        if (!process.env.MONGODB_URI || !serverStarted) {
            console.warn('Skipping server tests - MongoDB not available or server did not start');
            done();
            return;
        }

        ws = new WebSocket(`ws://localhost:${testPort}`);

        ws.on('open', () => {
            expect(ws.readyState).toBe(WebSocket.OPEN);
            done();
        });

        ws.on('error', (error) => {
            // If connection errors occur we assert failure via done to ensure test completes
            try {
                if (typeof done === 'function') {
                    done(new Error(`WebSocket connection error: ${error.message}`));
                } else {
                    throw new Error(`WebSocket connection error: ${error.message}`);
                }
            } catch (err) {
                // Ensure test completes
                throw err;
            }
        });
    }, 10000);

    it('should respond to getExtensions query', (done) => {
        if (!process.env.MONGODB_URI || !serverStarted) {
            console.warn('Skipping server tests - MongoDB not available or server did not start');
            done();
            return;
        }

        ws = new WebSocket(`ws://localhost:${testPort}`);

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
            if (typeof done === 'function') {
                done(new Error(`WebSocket error: ${error.message}`));
            } else {
                throw new Error(`WebSocket error: ${error.message}`);
            }
        });
    }, 10000);

    it('should respond to getCollections query', (done) => {
        if (!process.env.MONGODB_URI || !serverStarted) {
            console.warn('Skipping server tests - MongoDB not available or server did not start');
            done();
            return;
        }

        ws = new WebSocket(`ws://localhost:${testPort}`);

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
            // Assert failure for this done-style test
            try {
                if (typeof done === 'function') {
                    done(new Error(`WebSocket error: ${error.message}`));
                } else {
                    throw new Error(`WebSocket error: ${error.message}`);
                }
            } catch (err) {
                throw err;
            }
        });
    }, 10000);

    it('should handle invalid query method', (done) => {
        if (!process.env.MONGODB_URI || !serverStarted) {
            console.warn('Skipping server tests - MongoDB not available or server did not start');
            done();
            return;
        }

        ws = new WebSocket(`ws://localhost:${testPort}`);

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
            if (typeof done === 'function') {
                done(new Error(`WebSocket error: ${error.message}`));
            } else {
                throw new Error(`WebSocket error: ${error.message}`);
            }
        });
    }, 10000);
});
