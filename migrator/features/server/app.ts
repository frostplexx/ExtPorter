import { Globals } from '../../types/globals';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { Database } from '../database/db_manager';

interface MigratorProcess {
    process: ChildProcess | null;
    clientId: string;
}

interface MigrationState {
    isRunning: boolean;
    status: string;
    progress: {
        current: number;
        total: number;
    };
}

export class MigrationServer {
    globals: Globals;
    server: WebSocketServer;
    activeMigrators: Map<string, MigratorProcess> = new Map();
    private originalConsoleLog: typeof console.log;
    private originalConsoleError: typeof console.error;
    private originalConsoleWarn: typeof console.warn;
    private originalConsoleInfo: typeof console.info;
    private originalConsoleDebug: typeof console.debug;
    private migrationState: MigrationState = {
        isRunning: false,
        status: 'idle',
        progress: { current: 0, total: 0 },
    };
    private connectedClients: Set<WebSocket> = new Set();

    constructor(globals: Globals) {
        this.globals = globals;
        this.server = new WebSocketServer({ port: 8080 });

        // Save original console methods
        this.originalConsoleLog = console.log;
        this.originalConsoleError = console.error;
        this.originalConsoleWarn = console.warn;
        this.originalConsoleInfo = console.info;
        this.originalConsoleDebug = console.debug;
    }

    // Strip ANSI color codes from message
    private stripAnsi(str: string): string {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    }

    // Broadcast message to all connected clients
    private broadcastToClients(message: string): void {
        this.connectedClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Intercept console output and broadcast to all clients
    private interceptConsole(): () => void {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        console.log = function (...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleLog.apply(console, args);
        };

        console.info = function (...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleInfo.apply(console, args);
        };

        console.debug = function (...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleDebug.apply(console, args);
        };

        console.error = function (...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDERR: ${self.stripAnsi(message)}`);
            self.originalConsoleError.apply(console, args);
        };

        console.warn = function (...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleWarn.apply(console, args);
        };

        // Return cleanup function
        return () => {
            console.log = self.originalConsoleLog;
            console.info = self.originalConsoleInfo;
            console.debug = self.originalConsoleDebug;
            console.error = self.originalConsoleError;
            console.warn = self.originalConsoleWarn;
        };
    }

    // Get current database status
    private getDatabaseStatus(): string {
        if (!Database.shared.client || !Database.shared.database) {
            return 'disconnected';
        }
        return 'connected';
    }

    // Start the WebSocket server
    start(): void {
        console.log('Starting WebSocket server on port 8080...');

        // Handle new client connections
        this.server.on('connection', (ws: WebSocket) => {
            console.log('New client connected');

            // Add to connected clients
            this.connectedClients.add(ws);

            // Send initial database status to new client only
            const initialDbStatus = this.getDatabaseStatus();
            ws.send(`DB_STATUS:${initialDbStatus}`);

            // Send current migration status
            ws.send(`MIGRATION_STATUS:${this.migrationState.isRunning ? 'running' : 'stopped'}`);
            if (this.migrationState.isRunning) {
                ws.send(
                    `Migration in progress: ${this.migrationState.progress.current}/${this.migrationState.progress.total}`
                );
            }

            // Handle incoming messages from client
            ws.on('message', (message: Buffer) => {
                const command = message.toString().trim();
                console.log(`Received command from client: "${command}"`);

                // Try to parse as JSON for API calls
                try {
                    const jsonMessage = JSON.parse(command);
                    if (jsonMessage.type === 'db_query') {
                        this.handleDatabaseQuery(ws, jsonMessage).catch((error) => {
                            console.error('Error in handleDatabaseQuery:', error);
                            ws.send(
                                JSON.stringify({
                                    type: 'db_response',
                                    id: jsonMessage.id,
                                    error: error.message || String(error),
                                })
                            );
                        });
                        return;
                    }
                } catch {
                    // Not JSON, continue with legacy command handling
                }

                // Handle JSON commands for image downloads
                try {
                    const jsonMessage = JSON.parse(command);
                    if (jsonMessage.type === 'download_image') {
                        this.handleImageDownload(ws, jsonMessage).catch((error) => {
                            console.error('Error in handleImageDownload:', error);
                            ws.send(
                                JSON.stringify({
                                    type: 'image_response',
                                    id: jsonMessage.id,
                                    url: jsonMessage.url,
                                    error: error.message || String(error),
                                })
                            );
                        });
                        return;
                    }
                } catch {
                    // Not JSON, continue with legacy command handling
                }

                // Handle JSON commands for image downloads
                try {
                    const jsonMessage = JSON.parse(command);
                    if (jsonMessage.type === 'download_image') {
                        this.handleImageDownload(ws, jsonMessage).catch((error: Error) => {
                            console.error('Error in handleImageDownload:', error);
                            ws.send(
                                JSON.stringify({
                                    type: 'image_response',
                                    id: jsonMessage.id,
                                    url: jsonMessage.url,
                                    error: error.message || String(error),
                                })
                            );
                        });
                        return;
                    }
                } catch {
                    // Not JSON, continue with legacy command handling
                }

                // Handle migrator commands
                if (command === 'start') {
                    console.log('Starting migration via start command...');
                    this.handleStartCommand().catch((error) => {
                        console.error('Error in handleStartCommand:', error);
                        this.broadcastToClients(`ERROR: ${error.message || String(error)}`);
                    });
                } else if (command.startsWith('migrate ')) {
                    this.handleMigrateCommand(ws, command);
                } else if (command === 'stop') {
                    this.stopMigrator(ws);
                } else if (command === 'status') {
                    this.sendStatus(ws);
                } else if (command.startsWith('LAUNCH_DUAL:')) {
                    this.handleLaunchDual(ws, command);
                } else if (command === 'CLOSE_BROWSERS') {
                    this.handleCloseBrowsers(ws);
                } else {
                    ws.send(`Server received: ${command}`);
                }
            });

            // Handle client disconnect
            ws.on('close', () => {
                console.log('Client disconnected');
                this.connectedClients.delete(ws);
            });

            // Handle errors
            ws.on('error', (error: Error) => {
                console.error('WebSocket error:', error);
            });
        });

        // Server listening event
        this.server.on('listening', () => {
            console.log('WebSocket server listening on port 8080');
        });

        // Server error handling
        this.server.on('error', (error: Error) => {
            console.error('Server error:', error);
        });
    }

    // Broadcast message to all connected clients
    broadcast(message: string): void {
        this.server.clients.forEach((client: WebSocket) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Handle start command (runs full migration pipeline)
    private async handleStartCommand(): Promise<void> {
        // Check if migration is already running
        if (this.migrationState.isRunning) {
            this.broadcastToClients(
                'Error: Migration is already running. Stop it first before starting a new one.'
            );
            return;
        }

        // Mark migration as running
        this.migrationState.isRunning = true;
        this.migrationState.status = 'starting';
        this.broadcastToClients('MIGRATION_STATUS:running');

        // Intercept console output for this migration
        const restoreConsole = this.interceptConsole();

        this.broadcastToClients('Starting migration pipeline...');

        try {
            // Import migration dependencies dynamically to avoid circular dependencies
            const { find_extensions } = await import('../../utils/find_extensions.js');
            // logger is imported but not used in this scope - it's used elsewhere in the codebase
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { logger } = await import('../../utils/logger.js');
            const { RenameAPIS } = await import('../../modules/api_renames/index.js');
            const { MigrateManifest } = await import('../../modules/manifest/index.js');
            const { MigrateCSP } = await import('../../modules/csp/index.js');
            const { InterestingnessScorer } = await import(
                '../../modules/interestingenss_scorer/index.js'
            );
            const { BridgeInjector } = await import('../../modules/bridge_injector/index.js');
            const { OffscreenDocumentMigrator } = await import(
                '../../modules/offscreen_documents/index.js'
            );
            const { WebRequestMigrator } = await import(
                '../../modules/web_request_migrator/web_request_migrator.js'
            );
            const { WriteMigrated } = await import('../../modules/write_extension/index.js');
            const { WriteQueue } = await import('../../modules/write_extension/write-queue.js');
            const { extensionUtils } = await import('../../utils/extension_utils.js');
            const { MigrationError } = await import('../../types/migration_module.js');
            const path = await import('path');

            this.broadcastToClients(`Starting extension search in: ${this.globals.extensionsPath}`);
            let extensions = find_extensions(this.globals.extensionsPath);
            this.broadcastToClients(`Found ${extensions.length} extensions`);

            // Filter out new-tab extensions if setting is enabled
            const filterNewTab = process.env.FILTER_NEW_TAB_EXTENSIONS === 'true';
            if (filterNewTab) {
                const originalCount = extensions.length;
                extensions = extensions.filter((extension) => !extension.isNewTabExtension);
                const filteredCount = originalCount - extensions.length;
                if (filteredCount > 0) {
                    this.broadcastToClients(`Filtered out ${filteredCount} new-tab extensions`);
                }
            }

            // Migration modules
            const migrationModules = [
                WebRequestMigrator.migrate,
                MigrateManifest.migrate,
                MigrateCSP.migrate,
                RenameAPIS.migrate,
                BridgeInjector.migrate,
                OffscreenDocumentMigrator.migrate,
                InterestingnessScorer.migrate,
                WriteMigrated.migrate,
            ];

            const BATCH_SIZE = parseInt(process.env.MIGRATION_BATCH_SIZE || '10');
            const totalExtensions = extensions.length;
            this.migrationState.progress.total = totalExtensions;
            let writeIndex = 0;

            this.broadcastToClients(
                `Processing ${totalExtensions} extensions in batches of ${BATCH_SIZE}`
            );

            // Process extensions in batches
            for (let batchStart = 0; batchStart < totalExtensions; batchStart += BATCH_SIZE) {
                // Check if migration was stopped
                if (!this.migrationState.isRunning) {
                    this.broadcastToClients('Migration stopped by user');
                    break;
                }

                const batchEnd = Math.min(batchStart + BATCH_SIZE, totalExtensions);
                const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(totalExtensions / BATCH_SIZE);

                this.broadcastToClients(
                    `Processing batch ${batchNumber}/${totalBatches}: extensions ${batchStart + 1}-${batchEnd}`
                );

                // Process each extension in the current batch
                for (let i = batchStart; i < batchEnd; i++) {
                    // Check if migration was stopped
                    if (!this.migrationState.isRunning) {
                        this.broadcastToClients('Migration stopped by user');
                        break;
                    }

                    let extension = extensions[i];
                    let migrationSuccessful = true;

                    // Run through migration pipeline (excluding WriteMigrated for now)
                    const migrationOnly = migrationModules.slice(0, -1);
                    for (const migrateFunction of migrationOnly) {
                        const migrated = await migrateFunction(extension);
                        if (migrated && !(migrated instanceof MigrationError)) {
                            extension = migrated;
                        } else {
                            migrationSuccessful = false;
                            break;
                        }
                    }

                    // Write the migrated extension to disk
                    if (migrationSuccessful) {
                        try {
                            const useNewTabSubfolder = process.env.NEW_TAB_SUBFOLDER === 'true';
                            const isNewTab = extension.isNewTabExtension || false;
                            const extensionId = extension.mv3_extension_id || extension.id;

                            let outputPath: string;
                            if (useNewTabSubfolder && isNewTab) {
                                outputPath = path.join(
                                    this.globals.outputDir,
                                    'new_tab_extensions',
                                    extensionId
                                );
                            } else {
                                outputPath = path.join(this.globals.outputDir, extensionId);
                            }

                            await WriteQueue.shared.writeExtensionSync(extension, outputPath);

                            // Insert migrated extension to database
                            const Database = (await import('../database/db_manager.js')).Database;
                            const dbExtension = {
                                ...extension,
                                manifest_v3_path: outputPath,
                                files: [],
                            };

                            await Database.shared.insertMigratedExtension(dbExtension);
                            writeIndex++;
                            this.migrationState.progress.current = writeIndex;

                            if (writeIndex % 5 === 0) {
                                this.broadcastToClients(
                                    `Progress: ${writeIndex}/${totalExtensions} extensions migrated`
                                );
                            }
                        } catch (writeError) {
                            migrationSuccessful = false;
                            this.broadcastToClients(
                                `Error writing extension ${extension.name}: ${writeError instanceof Error ? writeError.message : String(writeError)}`
                            );
                        }
                    }

                    // Clear extension from memory
                    extensionUtils.closeExtensionFiles(extension);
                    extensions[i] = null as any;
                }

                await WriteQueue.shared.flush();
                this.broadcastToClients(`Completed batch ${batchNumber}/${totalBatches}`);
            }

            this.broadcastToClients(
                `Migration completed! Successfully migrated ${writeIndex} extensions`
            );
            this.migrationState.isRunning = false;
            this.migrationState.status = 'completed';
            this.broadcastToClients('MIGRATION_STATUS:stopped');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.broadcastToClients(`Migration failed: ${errorMessage}`);
            this.migrationState.isRunning = false;
            this.migrationState.status = 'failed';
            this.broadcastToClients('MIGRATION_STATUS:stopped');
        } finally {
            // Restore console to original state
            restoreConsole();
        }
    }

    // Handle migrate command
    private handleMigrateCommand(ws: WebSocket, command: string): void {
        const extensionId = command.replace('migrate ', '').trim();

        if (!extensionId) {
            ws.send('Error: Please provide an extension ID. Usage: migrate <extension-id>');
            return;
        }

        // Stop any existing migrator for this client
        this.stopMigrator(ws);

        // Start migrator process
        const migratorProcess = spawn('yarn', ['server'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, EXTENSION_ID: extensionId },
        });

        const clientId = this.getClientId(ws);
        this.activeMigrators.set(clientId, {
            process: migratorProcess,
            clientId,
        });

        ws.send(`Starting migration for extension: ${extensionId}`);

        // Stream stdout to client
        migratorProcess.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            console.log(`Migrator output: ${output.trim()}`);
            ws.send(output);
        });

        // Stream stderr to client
        migratorProcess.stderr?.on('data', (data: Buffer) => {
            const error = data.toString();
            console.error(`Migrator error: ${error.trim()}`);
            ws.send(`ERROR: ${error}`);
        });

        // Handle process completion
        migratorProcess.on('close', (code: number | null) => {
            console.log(`Migrator process exited with code: ${code}`);
            ws.send(`Migration completed with exit code: ${code}`);
            this.activeMigrators.delete(clientId);
        });

        migratorProcess.on('error', (error: Error) => {
            console.error(`Migrator process error: ${error.message}`);
            ws.send(`Migrator error: ${error.message}`);
            this.activeMigrators.delete(clientId);
        });
    }

    // Stop migrator
    private stopMigrator(ws: WebSocket): void {
        // Check for new migration system
        if (this.migrationState.isRunning) {
            this.migrationState.isRunning = false;
            this.migrationState.status = 'stopped';
            this.broadcastToClients('Migration stopped');
            this.broadcastToClients('MIGRATION_STATUS:stopped');
            return;
        }

        // Fallback to old migration system (for migrate command)
        const clientId = this.getClientId(ws);
        const migrator = this.activeMigrators.get(clientId);

        if (migrator) {
            // Kill process if it exists (for old migrate command)
            if (migrator.process) {
                migrator.process.kill('SIGTERM');
            }
            this.activeMigrators.delete(clientId);
            ws.send('Migration stopped');
        } else {
            ws.send('No active migration to stop');
        }
    }

    // Send status of active migrators
    private sendStatus(ws: WebSocket): void {
        const clientId = this.getClientId(ws);
        const migrator = this.activeMigrators.get(clientId);

        if (migrator) {
            ws.send('Migration in progress...');
        } else {
            ws.send('No active migration');
        }
    }

    // Get client identifier
    private getClientId(ws: WebSocket): string {
        return (ws as any).id || 'default';
    }

    // Handle database query requests
    private async handleDatabaseQuery(ws: WebSocket, message: any): Promise<void> {
        const { id, method, params } = message;

        try {
            let result: any;

            switch (method) {
                case 'getExtensions':
                    // Fetch all extensions from database
                    result = await Database.shared.getAllExtensions();
                    break;

                case 'getExtensionsWithStats':
                    // Fetch all extensions with pre-calculated statistics and sorting
                    result = await Database.shared.getExtensionsWithStats();
                    break;

                case 'findExtension':
                    // Find a specific extension by filter
                    result = await Database.shared.findExtension(params.filter || {});
                    break;

                case 'getCollections':
                    // Get list of collections with counts
                    result = await Database.shared.getCollections();
                    break;

                case 'queryCollection':
                    // Query a specific collection
                    result = await Database.shared.queryCollection(
                        params.collection,
                        params.query || {},
                        params.limit || 10
                    );
                    break;

                case 'countDocuments':
                    // Count documents in a collection
                    result = await Database.shared.countDocuments(
                        params.collection,
                        params.query || {}
                    );
                    break;

                case 'getLogs':
                    // Get logs with optional limit and sort
                    result = await Database.shared.getLogs(params.limit || 50);
                    break;

                default:
                    throw new Error(`Unknown database method: ${method}`);
            }

            // Send success response
            ws.send(
                JSON.stringify({
                    type: 'db_response',
                    id,
                    result,
                })
            );
        } catch (error) {
            // Send error response
            ws.send(
                JSON.stringify({
                    type: 'db_response',
                    id,
                    error: error instanceof Error ? error.message : String(error),
                })
            );
        }
    }

    // Handle launch dual browsers command
    private async handleLaunchDual(ws: WebSocket, command: string): Promise<void> {
        try {
            const extensionId = command.replace('LAUNCH_DUAL:', '').trim();

            if (!extensionId) {
                ws.send('ERROR: Extension ID is required');
                return;
            }

            // Import DualChromeTester dynamically
            const { DualChromeTester } = await import('../../../ext_tester/dual_chrome_tester.js');
            const fs = await import('fs');
            const path = await import('path');

            // Get extension from database
            const extensionDoc = await Database.shared.findExtension({ id: extensionId });

            if (!extensionDoc) {
                ws.send(`ERROR: Extension ${extensionId} not found in database`);
                return;
            }

            // Validate that extension has required paths
            const ext = extensionDoc as any;
            if (!ext.manifest_v2_path) {
                ws.send(`ERROR: Extension ${ext.name} is missing manifest_v2_path`);
                return;
            }
            if (!ext.manifest_v3_path) {
                ws.send(`ERROR: Extension ${ext.name} is missing manifest_v3_path`);
                return;
            }

            // Strip /manifest.json if present to get directory paths
            const mv2Dir = ext.manifest_v2_path.endsWith('manifest.json')
                ? ext.manifest_v2_path.replace(/\/manifest\.json$/, '')
                : ext.manifest_v2_path;
            const mv3Dir = ext.manifest_v3_path.endsWith('manifest.json')
                ? ext.manifest_v3_path.replace(/\/manifest\.json$/, '')
                : ext.manifest_v3_path;

            // Check if directories exist
            if (!fs.existsSync(mv2Dir)) {
                ws.send(`ERROR: MV2 extension directory does not exist: ${mv2Dir}`);
                return;
            }
            if (!fs.existsSync(mv3Dir)) {
                ws.send(`ERROR: MV3 extension directory does not exist: ${mv3Dir}`);
                return;
            }

            // Check if manifest.json files exist in those directories
            const mv2Manifest = path.join(mv2Dir, 'manifest.json');
            const mv3Manifest = path.join(mv3Dir, 'manifest.json');

            if (!fs.existsSync(mv2Manifest)) {
                ws.send(`ERROR: MV2 manifest.json not found at: ${mv2Manifest}`);
                return;
            }
            if (!fs.existsSync(mv3Manifest)) {
                ws.send(`ERROR: MV3 manifest.json not found at: ${mv3Manifest}`);
                return;
            }

            ws.send(`Launching dual browsers for extension: ${ext.name}`);
            ws.send(`MV2 path: ${mv2Dir}`);
            ws.send(`MV3 path: ${mv3Dir}`);

            // Launch both browsers - cast to any to bypass type checking
            await DualChromeTester.shared.initDualBrowsers(extensionDoc as any, 3, false);

            ws.send('DUAL_BROWSERS_LAUNCHED');
            ws.send(`Both browsers launched successfully for ${ext.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : '';
            ws.send(`ERROR launching dual browsers: ${errorMessage}`);
            if (errorStack) {
                ws.send(`Stack trace: ${errorStack}`);
            }
        }
    }

    // Handle close browsers command
    private async handleCloseBrowsers(ws: WebSocket): Promise<void> {
        try {
            // Import DualChromeTester dynamically
            const { DualChromeTester } = await import('../../../ext_tester/dual_chrome_tester.js');

            await DualChromeTester.shared.closeAll();

            ws.send('BROWSERS_CLOSED');
            ws.send('All browsers closed successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ws.send(`ERROR closing browsers: ${errorMessage}`);
        }
    }

    // Handle image download requests
    private async handleImageDownload(
        ws: WebSocket,
        message: { id: string; url: string; size?: number }
    ): Promise<void> {
        const { id, url, size = 1280 } = message;

        try {
            // Import required modules
            const https = await import('https');
            const http = await import('http');

            // Convert to high resolution URL
            const highResUrl = this.getHighResImageUrl(url, size);

            const protocol = highResUrl.startsWith('https') ? https : http;

            const options = {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
                },
                timeout: 15000,
            };

            // Download image
            const imageData = await new Promise<Buffer>((resolve, reject) => {
                const request = protocol.get(highResUrl, options, (response) => {
                    // Follow redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        if (response.headers.location) {
                            reject(new Error(`Redirect to: ${response.headers.location}`));
                            return;
                        }
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }

                    const chunks: Buffer[] = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks)));
                    response.on('error', reject);
                });

                request.on('error', reject);
                request.on('timeout', () => {
                    request.destroy();
                    reject(new Error('Request timeout'));
                });
            });

            // Convert to base64
            const base64Data = imageData.toString('base64');

            // Send response
            ws.send(
                JSON.stringify({
                    type: 'image_response',
                    id,
                    url,
                    data: base64Data,
                })
            );
        } catch (error) {
            // Send error response
            ws.send(
                JSON.stringify({
                    type: 'image_response',
                    id,
                    url,
                    error: error instanceof Error ? error.message : String(error),
                })
            );
        }
    }

    // Get high resolution image URL for googleusercontent
    private getHighResImageUrl(url: string, size: number = 0): string {
        // For Googleusercontent images, modify the size parameter
        if (url.includes('googleusercontent.com')) {
            // Remove existing size parameters and add high-res one
            // Patterns like =s128, =w128, =h128, etc.
            url = url.replace(/=[swh]\d+/g, '');
            // Remove trailing parameters that might interfere
            url = url.replace(/-rj-sc0x[0-9a-f]+$/, '');
            // Add high resolution parameter
            return `${url}=s${size}`;
        }
        return url;
    }

    // Close the server gracefully
    close(): void {
        // Stop all active migrators
        for (const migrator of this.activeMigrators.values()) {
            if (migrator.process) {
                migrator.process.kill('SIGTERM');
            }
        }
        this.activeMigrators.clear();

        // Restore original console methods
        console.log = this.originalConsoleLog;
        console.info = this.originalConsoleInfo;
        console.debug = this.originalConsoleDebug;
        console.error = this.originalConsoleError;
        console.warn = this.originalConsoleWarn;

        this.server.close(() => {});
    }
}
