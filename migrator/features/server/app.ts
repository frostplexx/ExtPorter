import { Globals } from '../../types/globals';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { Database } from '../database/db_manager';
import { llmManager, buildChatMessagesFromFile } from '../llm/index.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
const tar = require('tar-stream');

// Prevent noisy MaxListeners warnings and accidental memory leaks in tests/runtime
// Increase default max listeners to a reasonable value for the server lifetime
import { EventEmitter } from 'events';
import { MemoryProfiler } from '../../utils/memory_profiler';
EventEmitter.defaultMaxListeners = Number(process.env.EVENT_LISTENER_LIMIT || 50);

// Chunked download constants
const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks
const CHUNK_THRESHOLD = 10 * 1024 * 1024; // 10MB - chunk if larger

// Server-side limits to protect memory
const MAX_FULL_EXTENSIONS = Number(process.env.MAX_FULL_EXTENSIONS || 2000); // max items when a full list is explicitly requested
const MAX_PAGE_SIZE = Number(process.env.MAX_PAGE_SIZE || 1000); // maximum pageSize clients can request

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
    private llmInitialized: boolean = false;

    // Memory management: connection timeouts and periodic cleanup
    private readonly connectionTimeout = 5 * 60 * 1000; // 5 minutes inactivity timeout
    private connectionTimers: Map<WebSocket, NodeJS.Timeout> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly cleanupIntervalMs = 60 * 1000; // Run cleanup every minute

    constructor(globals: Globals) {
        this.globals = globals;
        this.server = new WebSocketServer({
            port: 8080,
            maxPayload: 100 * 1024 * 1024, // 100MB max payload size
        });

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

        console.log = function(...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleLog.apply(console, args);
        };

        console.info = function(...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleInfo.apply(console, args);
        };

        console.debug = function(...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDOUT: ${self.stripAnsi(message)}`);
            self.originalConsoleDebug.apply(console, args);
        };

        console.error = function(...args: any[]) {
            const message = args
                .map((arg) =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                )
                .join(' ');

            self.broadcastToClients(`STDERR: ${self.stripAnsi(message)}`);
            self.originalConsoleError.apply(console, args);
        };

        console.warn = function(...args: any[]) {
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
    async start(): Promise<void> {
        console.log('Starting WebSocket server on port 8080...');

        // Initialize LLM manager and SSH tunnel at startup
        try {
            console.log('Initializing LLM service...');
            await llmManager.getService();
            this.llmInitialized = true;
            console.log('✓ LLM service initialized and ready');
        } catch (error) {
            console.error('Failed to initialize LLM service:', error);
            console.log('LLM description generation will not be available');
            this.llmInitialized = false;
        }

        // Start periodic cleanup for memory management
        this.cleanupInterval = setInterval(() => this.periodicCleanup(), this.cleanupIntervalMs);

        // Ensure server is actually listening before returning (avoid race conditions in tests)
        await new Promise<void>((resolve, reject) => {
            try {
                if (this.server.address()) {
                    resolve();
                    return;
                }

                const onListening = () => {
                    this.server.removeListener('error', onError);
                    resolve();
                };
                const onError = (err: any) => {
                    this.server.removeListener('listening', onListening);
                    reject(err);
                };

                this.server.once('listening', onListening);
                this.server.once('error', onError);

                // Safety timeout
                setTimeout(() => {
                    this.server.removeListener('listening', onListening);
                    this.server.removeListener('error', onError);
                    reject(new Error('WebSocket server did not start listening within timeout'));
                }, 5000);
            } catch (err) {
                reject(err as any);
            }
        });

        // Handle new client connections
        this.server.on('connection', (ws: WebSocket) => {
            console.log('New client connected');

            // Add to connected clients
            this.connectedClients.add(ws);

            // Set initial connection timeout
            this.resetConnectionTimeout(ws);

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
                // Reset connection timeout on any activity
                this.resetConnectionTimeout(ws);

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
                } else if (command.startsWith('GENERATE_DESCRIPTION:')) {
                    this.handleGenerateDescription(ws, command);
                } else if (command.startsWith('FIX_EXTENSION:')) {
                    this.handleFixExtension(ws, command);
                } else if (command.startsWith('DOWNLOAD_EXTENSION:')) {
                    this.handleDownloadExtension(ws, command);
                } else {
                    ws.send(`Server received: ${command}`);
                }
            });

            // Handle client disconnect
            ws.on('close', () => {
                console.log('Client disconnected');
                this.clearConnectionTimeout(ws);
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
            const { logger } = await import('../../utils/logger.js');
            const { RenameAPIS } = await import('../../modules/api_renames/index.js');
            const { MigrateManifest } = await import('../../modules/manifest/index.js');
            const { MigrateCSP } = await import('../../modules/csp/index.js');
            const { InterestingnessScorer } = await import(
                '../../modules/interestingenss_scorer/index.js'
            );
            const { ListenerAnalyzer } = await import('../../modules/listener_analyzer/index.js');
            const { BridgeInjector } = await import('../../modules/bridge_injector/index.js');
            const { OffscreenDocumentMigrator } = await import(
                '../../modules/offscreen_documents/index.js'
            );
            const { WebRequestMigrator } = await import(
                '../../modules/web_request_migrator/web_request_migrator.js'
            );
            const { WriteMigrated } = await import('../../modules/write_extension/index.js');
            const { WriteQueue } = await import('../../modules/write_extension/write-queue.js');
            const { MigrationError } = await import('../../types/migration_module.js');
            const path = await import('path');

            MemoryProfiler.takeHeapSnapshot('start');

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
                ListenerAnalyzer.migrate, // Extract event listeners
                InterestingnessScorer.migrate,
                WriteMigrated.migrate,
            ];

            const BATCH_SIZE = parseInt(process.env.MIGRATION_BATCH_SIZE || '10');
            const totalExtensions = extensions.length;
            this.migrationState.progress.total = totalExtensions;
            let writeIndex = 0;
            let processedCount = 0;

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

                    processedCount++;
                    if (processedCount % 10 === 0 && global.gc) {
                        global.gc(); // Force GC every 10 extensions

                        const used = process.memoryUsage();
                        logger.info(null, `GC after ${processedCount} extensions: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
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

                    if (i % 100 == 0) {
                        MemoryProfiler.takeHeapSnapshot(`after-${i}-extensions`);
                        MemoryProfiler.printHeapStats();
                    }

                    // Clear extension from memory thoroughly
                    const { clearExtensionMemory, forceGarbageCollection, shouldTriggerGC } =
                        await import('../../utils/garbage.js');
                    clearExtensionMemory(extension);
                    extensions[i] = null as any;

                    // Trigger GC periodically during migration
                    if (writeIndex % 10 === 0 && shouldTriggerGC(16)) {
                        forceGarbageCollection();
                    }
                }

                await WriteQueue.shared.flush();
                this.broadcastToClients(`Completed batch ${batchNumber}/${totalBatches}`);
            }

            this.broadcastToClients(
                `Migration completed! Successfully migrated ${writeIndex} extensions`
            );

            MemoryProfiler.takeHeapSnapshot('end');
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
                    {
                        // Support paginated responses to avoid very large payloads.
                        // Clients can pass `page` and `pageSize` to fetch a specific page.
                        // For backward compatibility, clients may request the full list by sending `params.full === true`.
                        let page = Number(params?.page ?? 0);
                        let pageSize = Number(params?.pageSize ?? 100);
                        const search = typeof params?.search === 'string' ? params.search : null;
                        const sort = typeof params?.sort === 'string' ? params.sort : null;
                        const seed = typeof params?.seed === 'string' ? params.seed : null;

                        // Clamp pageSize to protect memory
                        if (isNaN(pageSize) || pageSize <= 0) pageSize = 100;
                        pageSize = Math.min(pageSize, MAX_PAGE_SIZE);
                        if (isNaN(page) || page < 0) page = 0;

                        if (params?.full === true) {
                            // Explicit request for full list (use with caution). Enforce hard limit.
                            const totalCount = await Database.shared.countDocuments('extensions');
                            if (totalCount > MAX_FULL_EXTENSIONS) {
                                throw new Error(
                                    `Refusing to return full list (${totalCount} items). Use pagination (page/pageSize) instead.`
                                );
                            }

                            result = await Database.shared.getExtensionsWithStats();
                        } else {
                            // Default: return a single page with metadata and optional search, sort and seed
                            result = await Database.shared.getExtensionsPageWithStats(
                                page,
                                pageSize,
                                search,
                                sort,
                                seed
                            );
                        }
                    }
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

                case 'createReport': {
                    // Create a new report with all fields from params
                    const report = {
                        id: params.id || `report_${Date.now()}_${params.extension_id}`,
                        extension_id: params.extension_id,
                        tested: params.tested !== false,
                        created_at: params.created_at || Date.now(),
                        updated_at: Date.now(),
                        // Copy all other fields from params
                        ...params,
                    };
                    result = await Database.shared.insertReport(report);
                    break;
                }

                case 'getAllReports':
                    result = await Database.shared.getAllReports();
                    break;

                case 'getReportByExtensionId':
                    result = await Database.shared.getReportByExtensionId(params.extension_id);
                    break;

                case 'updateReportTested':
                    result = await Database.shared.updateReportTested(
                        params.extension_id,
                        params.tested
                    );
                    break;

                case 'updateReport':
                    result = await Database.shared.updateReport(params.id, params);
                    break;

                case 'deleteReport':
                    result = await Database.shared.deleteReport(params.id);
                    break;

                case 'getReportById':
                    result = await Database.shared.getReportById(params.id);
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
            const DualChromeTesterModulePath = '../../../' + 'ext_tester/dual_chrome_tester.js';
            const { DualChromeTester } = await import(DualChromeTesterModulePath);
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

            // Open popup pages automatically
            ws.send('Opening extension popup/options pages...');
            await DualChromeTester.shared.openPopupPages(extensionDoc as any);
            ws.send('Extension pages opened');
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
            const DualChromeTesterModulePath = '../../../' + 'ext_tester/dual_chrome_tester.js';
            const { DualChromeTester } = await import(DualChromeTesterModulePath);

            await DualChromeTester.shared.closeAll();

            ws.send('BROWSERS_CLOSED');
            ws.send('All browsers closed successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ws.send(`ERROR closing browsers: ${errorMessage}`);
        }
    }

    // Handle LLM description generation
    private async handleGenerateDescription(ws: WebSocket, command: string): Promise<void> {
        const extensionId = command.replace('GENERATE_DESCRIPTION:', '').trim();

        try {
            console.log(`[LLM] Processing request for extension: ${extensionId}`);

            // Check if LLM is initialized
            if (!this.llmInitialized) {
                console.log(`[LLM] Service not initialized, sending error`);
                ws.send(
                    `LLM_DESCRIPTION_ERROR:${extensionId}:LLM service not initialized. Check server logs for details.`
                );
                return;
            }

            if (!extensionId) {
                ws.send('LLM_DESCRIPTION_ERROR:INVALID:Extension ID is required');
                return;
            }

            // Get extension from database
            console.log(`[LLM] Fetching extension from database...`);
            const extensionDoc = await Database.shared.findExtension({ id: extensionId });

            if (!extensionDoc) {
                console.log(`[LLM] Extension not found in database`);
                ws.send(`LLM_DESCRIPTION_ERROR:${extensionId}:Extension not found in database`);
                return;
            }

            const ext = extensionDoc as any;
            console.log(`[LLM] Found extension: ${ext.name}`);
            ws.send(`Generating LLM description for: ${ext.name}...`);

            // Get the prompt template path
            const templatePath = path.join(
                process.cwd(),
                'migrator',
                'prompts',
                'extension-description.txt'
            );

            if (!fs.existsSync(templatePath)) {
                console.log(`[LLM] Template not found at ${templatePath}`);
                ws.send(
                    `LLM_DESCRIPTION_ERROR:${extensionId}:Prompt template not found at ${templatePath}`
                );
                return;
            }

            // Build manifest summary
            const manifestSummary = this.buildManifestSummary(ext);

            // Get CWS description
            const cwsDescription = ext.cws_info?.description || 'No description available';

            // Simplified: not reading extension source files anymore
            // We only use CWS description and manifest for faster LLM generation

            // Build prompt variables
            const variables = {
                extension_name: ext.name || 'Unknown Extension',
                manifest_summary: manifestSummary,
                cws_description: cwsDescription,
            };

            // Build chat messages from template
            console.log(`[LLM] Building prompt from template...`);
            const messages = buildChatMessagesFromFile(templatePath, variables);

            // Get LLM service (already initialized, will reuse connection)
            console.log(`[LLM] Getting LLM service...`);
            const llmService = await llmManager.getService();
            console.log(`[LLM] Calling LLM API...`);
            ws.send(`Calling LLM service (this may take up to 3 minutes)...`);

            const description = await llmService.generateChatCompletion(messages, {
                streamToConsole: false,
            });

            console.log(`[LLM] Description generated successfully (${description.length} chars)`);

            // Send the description back
            // Encode as base64 to handle newlines and special characters
            const encoded = Buffer.from(description).toString('base64');
            ws.send(`LLM_DESCRIPTION:${extensionId}:${encoded}`);
            ws.send(`LLM description generated successfully for ${ext.name}`);

            console.log(`[LLM] Response sent to client for ${ext.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : '';

            console.error(`[LLM] Error generating description for ${extensionId}:`, errorMessage);
            if (errorStack) {
                console.error(`[LLM] Stack trace:`, errorStack);
            }

            ws.send(`LLM_DESCRIPTION_ERROR:${extensionId}:${errorMessage}`);
            ws.send(`ERROR generating LLM description: ${errorMessage}`);
        }
    }

    // Handle LLM-powered extension fixing
    private async handleFixExtension(ws: WebSocket, command: string): Promise<void> {
        const extensionId = command.replace('FIX_EXTENSION:', '').trim();

        try {
            console.log(`[LLM Fixer] Processing fix request for extension: ${extensionId}`);

            // Check if LLM is initialized
            if (!this.llmInitialized) {
                console.log(`[LLM Fixer] Service not initialized, sending error`);
                ws.send(
                    `FIX_EXTENSION_ERROR:${extensionId}:LLM service not initialized. Check server logs for details.`
                );
                return;
            }

            if (!extensionId) {
                ws.send('FIX_EXTENSION_ERROR:INVALID:Extension ID is required');
                return;
            }

            // Get extension from database
            console.log(`[LLM Fixer] Fetching extension from database...`);
            const extensionDoc = await Database.shared.findExtension({ id: extensionId });

            if (!extensionDoc) {
                console.log(`[LLM Fixer] Extension not found in database`);
                ws.send(`FIX_EXTENSION_ERROR:${extensionId}:Extension not found in database`);
                return;
            }

            // Get report for this extension
            console.log(`[LLM Fixer] Fetching report for extension...`);
            const report = await Database.shared.getReportByExtensionId(extensionId);

            if (!report) {
                console.log(`[LLM Fixer] No test report found for extension`);
                ws.send(
                    `FIX_EXTENSION_ERROR:${extensionId}:No test report found. Please test the extension first.`
                );
                return;
            }

            const ext = extensionDoc as any;
            console.log(`[LLM Fixer] Found extension: ${ext.name}`);
            ws.send(`Starting LLM-powered fix for: ${ext.name}...`);

            // Get LLM service (already initialized, will reuse connection)
            console.log(`[LLM Fixer] Getting LLM service...`);
            const llmService = await llmManager.getService();

            // Import ExtensionFixer
            const { ExtensionFixer } = await import('../llm/extension-fixer.js');

            // Create fixer
            console.log(`[LLM Fixer] Creating fixer instance...`);
            const fixer = await ExtensionFixer.fromExtension(llmService, ext, report);

            ws.send(`Analyzing extension and generating fixes (this may take several minutes)...`);
            console.log(`[LLM Fixer] Starting fix process...`);

            // Fix the extension
            const result = await fixer.fixExtension();

            console.log(`[LLM Fixer] Fix process completed:`, result);

            // Save fix attempt to database (regardless of success/failure)
            if (result.fixAttempt) {
                try {
                    await Database.shared.insertLLMFixAttempt(result.fixAttempt);
                    console.log(
                        `[LLM Fixer] Fix attempt saved to database with ID: ${result.fixAttempt.id}`
                    );
                } catch (dbError) {
                    console.error(`[LLM Fixer] Failed to save fix attempt to database:`, dbError);
                    // Don't fail the whole operation if DB save fails
                }
            }

            if (result.success) {
                ws.send(
                    `FIX_EXTENSION_SUCCESS:${extensionId}:${JSON.stringify({
                        message: result.message,
                        filesModified: result.filesModified,
                    })}`
                );
                ws.send(`Extension fixed successfully!`);
                ws.send(`Files modified: ${result.filesModified.join(', ')}`);
                ws.send(`Summary: ${result.message}`);
            } else {
                ws.send(`FIX_EXTENSION_ERROR:${extensionId}:${result.error || result.message}`);
                ws.send(`Failed to fix extension: ${result.error || result.message}`);
            }

            console.log(`[LLM Fixer] Response sent to client for ${ext.name}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : '';

            console.error(`[LLM Fixer] Error fixing extension ${extensionId}:`, errorMessage);
            if (errorStack) {
                console.error(`[LLM Fixer] Stack trace:`, errorStack);
            }

            ws.send(`FIX_EXTENSION_ERROR:${extensionId}:${errorMessage}`);
            ws.send(`ERROR fixing extension: ${errorMessage}`);
        }
    }

    // Handle extension download for client-side testing
    private async handleDownloadExtension(ws: WebSocket, command: string): Promise<void> {
        // Parse command: DOWNLOAD_EXTENSION:{extension_id} or DOWNLOAD_EXTENSION:{extension_id}:{client_hash}
        const parts = command.replace('DOWNLOAD_EXTENSION:', '').split(':');
        const extensionId = parts[0].trim();
        const clientHash = parts[1]?.trim();

        try {
            console.log(`[Download] Processing request for extension: ${extensionId}`);
            if (clientHash) {
                console.log(`[Download] Client provided hash: ${clientHash}`);
            }

            if (!extensionId) {
                ws.send('DOWNLOAD_EXTENSION_ERROR:INVALID:Extension ID is required');
                return;
            }

            // Get extension from database
            const extensionDoc = await Database.shared.findExtension({ id: extensionId });

            if (!extensionDoc) {
                ws.send(`DOWNLOAD_EXTENSION_ERROR:${extensionId}:Extension not found in database`);
                return;
            }

            const ext = extensionDoc as any;

            // Validate paths
            if (!ext.manifest_v2_path) {
                ws.send(
                    `DOWNLOAD_EXTENSION_ERROR:${extensionId}:Extension is missing manifest_v2_path`
                );
                return;
            }
            if (!ext.manifest_v3_path) {
                ws.send(
                    `DOWNLOAD_EXTENSION_ERROR:${extensionId}:Extension is missing manifest_v3_path`
                );
                return;
            }

            // Get directory paths
            const mv2Dir = ext.manifest_v2_path.endsWith('manifest.json')
                ? ext.manifest_v2_path.replace(/\/manifest\.json$/, '')
                : ext.manifest_v2_path;
            const mv3Dir = ext.manifest_v3_path.endsWith('manifest.json')
                ? ext.manifest_v3_path.replace(/\/manifest\.json$/, '')
                : ext.manifest_v3_path;

            // Check if directories exist
            if (!fs.existsSync(mv2Dir)) {
                ws.send(
                    `DOWNLOAD_EXTENSION_ERROR:${extensionId}:MV2 directory not found: ${mv2Dir}`
                );
                return;
            }
            if (!fs.existsSync(mv3Dir)) {
                ws.send(
                    `DOWNLOAD_EXTENSION_ERROR:${extensionId}:MV3 directory not found: ${mv3Dir}`
                );
                return;
            }

            // Calculate hash
            const serverHash = await this.calculateExtensionHash(mv2Dir, mv3Dir);
            console.log(`[Download] Server hash: ${serverHash}`);

            // If client has same hash, skip download
            if (clientHash && clientHash === serverHash) {
                console.log(`[Download] Hash match, sending CACHED response`);
                ws.send(`DOWNLOAD_EXTENSION_CACHED:${extensionId}`);
                return;
            }

            console.log(`[Download] Creating tar.gz archives (streaming to temp files)...`);

            // Create tar.gz archives for both directories and write to temp files
            const mv2TempPath = await this.createTarGzToFile(mv2Dir);
            const mv3TempPath = await this.createTarGzToFile(mv3Dir);

            const mv2Stat = await fs.promises.stat(mv2TempPath);
            const mv3Stat = await fs.promises.stat(mv3TempPath);

            const mv2Size = Number(mv2Stat.size);
            const mv3Size = Number(mv3Stat.size);

            console.log(`[Download] Archive sizes (files) - MV2: ${mv2Size}, MV3: ${mv3Size}`);

            // Build header: 8 bytes size header (mv2_size, mv3_size)
            const sizeHeader = Buffer.alloc(8);
            sizeHeader.writeUInt32BE(mv2Size, 0);
            sizeHeader.writeUInt32BE(mv3Size, 4);

            const totalSize = 8 + mv2Size + mv3Size;

            // If totalSize exceeds chunk threshold, stream using chunked transfer
            if (totalSize > CHUNK_THRESHOLD) {
                console.log(
                    `[Download] Large extension (${totalSize} bytes), using chunked transfer (streamed)`
                );

                // Stream temp files into a single payload by reading them in chunks and sending chunk messages
                await this.sendChunkedFiles(
                    ws,
                    extensionId,
                    mv2TempPath,
                    mv3TempPath,
                    mv2Size,
                    mv3Size,
                    serverHash
                );
            } else {
                // Small extension - read files into memory safely and send as single message
                const mv2Buffer = await fs.promises.readFile(mv2TempPath);
                const mv3Buffer = await fs.promises.readFile(mv3TempPath);

                const payload = Buffer.concat([sizeHeader, mv2Buffer, mv3Buffer]);

                // Format: "DOWNLOAD_EXTENSION_START:{ext_id}:{size}:{hash}\n" + binary payload
                const textHeader = Buffer.from(
                    `DOWNLOAD_EXTENSION_START:${extensionId}:${payload.length}:${serverHash}\n`
                );
                const fullMessage = Buffer.concat([textHeader, payload]);
                ws.send(fullMessage);

                console.log(
                    `[Download] Sent ${fullMessage.length} bytes for extension ${ext.name}`
                );
            }

            // Cleanup temp files
            try {
                await fs.promises.unlink(mv2TempPath);
            } catch {
                // Ignore unlink errors
            }
            try {
                await fs.promises.unlink(mv3TempPath);
            } catch {
                // Ignore unlink errors
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Download] Error downloading extension ${extensionId}:`, errorMessage);
            ws.send(`DOWNLOAD_EXTENSION_ERROR:${extensionId}:${errorMessage}`);
        }
    }

    // Send extension using chunked transfer for large in-memory payloads (legacy)
    private async sendChunkedExtension(
        ws: WebSocket,
        extensionId: string,
        payload: Buffer,
        hash: string
    ): Promise<void> {
        const totalChunks = Math.ceil(payload.length / CHUNK_SIZE);

        // Calculate MD5 hash of payload for verification
        const payloadHash = crypto.createHash('md5').update(payload).digest('hex');

        console.log(
            `[Download] Starting chunked transfer: ${totalChunks} chunks, ${payload.length} bytes, hash: ${payloadHash}`
        );

        // Send start message as binary (so it goes to binary handler on client)
        // Format: DOWNLOAD_EXTENSION_CHUNK_START:{ext_id}:{total_size}:{total_chunks}:{payload_hash}:{dir_hash}\n
        const startMessage = Buffer.from(
            `DOWNLOAD_EXTENSION_CHUNK_START:${extensionId}:${payload.length}:${totalChunks}:${payloadHash}:${hash}\n`
        );
        ws.send(startMessage, { binary: true });

        // Send chunks
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, payload.length);
            const chunkData = payload.subarray(start, end);

            // Format: "DOWNLOAD_EXTENSION_CHUNK:{ext_id}:{chunk_index}:{chunk_size}\n" + binary chunk
            const chunkHeader = Buffer.from(
                `DOWNLOAD_EXTENSION_CHUNK:${extensionId}:${i}:${chunkData.length}\n`
            );
            const chunkMessage = Buffer.concat([chunkHeader, chunkData]);
            ws.send(chunkMessage, { binary: true });

            // Log progress every 5 chunks
            if (i % 5 === 0 || i === totalChunks - 1) {
                console.log(`[Download] Sent chunk ${i + 1}/${totalChunks}`);
            }

            // Small delay to avoid overwhelming the connection
            if (i < totalChunks - 1) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        // Send end message as binary (so it goes to binary handler on client)
        const endMessage = Buffer.from(`DOWNLOAD_EXTENSION_CHUNK_END:${extensionId}\n`);
        ws.send(endMessage, { binary: true });

        console.log(`[Download] Chunked transfer complete for ${extensionId}`);
    }

    // Stream two tar.gz files from disk using chunked messages to avoid large memory usage
    private async sendChunkedFiles(
        ws: WebSocket,
        extensionId: string,
        mv2Path: string,
        mv3Path: string,
        mv2Size: number,
        mv3Size: number,
        dirHash: string
    ): Promise<void> {
        const totalSize = 8 + mv2Size + mv3Size; // header + two files
        const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

        // Prepare MD5 of concatenated files by streaming them (do not load into memory)
        const md5 = crypto.createHash('md5');
        await new Promise<void>((resolve, reject) => {
            const stream1 = fs.createReadStream(mv2Path);
            stream1.on('data', (chunk: any) => md5.update(chunk));
            stream1.on('end', () => {
                const stream2 = fs.createReadStream(mv3Path);
                stream2.on('data', (chunk: any) => md5.update(chunk));
                stream2.on('end', () => resolve());
                stream2.on('error', reject);
            });
            stream1.on('error', reject);
        });

        const payloadHash = md5.digest('hex');

        console.log(
            `[Download] Starting streamed chunked transfer: ${totalChunks} chunks, ${totalSize} bytes, hash: ${payloadHash}`
        );

        // Send start message
        const startMessage = Buffer.from(
            `DOWNLOAD_EXTENSION_CHUNK_START:${extensionId}:${totalSize}:${totalChunks}:${payloadHash}:${dirHash}\n`
        );
        ws.send(startMessage, { binary: true });

        // We'll send files in sequence as chunk messages (no separate header chunk needed)

        let chunkIndex = 0;

        // Helper to stream a file in chunks
        const streamFileAsChunks = (filePath: string) =>
            new Promise<void>((resolve, reject) => {
                const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
                stream.on('data', (chunk: any) => {
                    const chunkHeader = Buffer.from(
                        `DOWNLOAD_EXTENSION_CHUNK:${extensionId}:${chunkIndex}:${chunk.length}\n`
                    );
                    ws.send(Buffer.concat([chunkHeader, chunk]), { binary: true });
                    chunkIndex++;
                });
                stream.on('end', resolve);
                stream.on('error', reject);
            });

        // Stream mv2 file
        await streamFileAsChunks(mv2Path);
        // Stream mv3 file
        await streamFileAsChunks(mv3Path);

        // Send end message
        const endMessage = Buffer.from(`DOWNLOAD_EXTENSION_CHUNK_END:${extensionId}\n`);
        ws.send(endMessage, { binary: true });

        console.log(`[Download] Streamed chunked transfer complete for ${extensionId}`);
    }

    // Calculate MD5 hash of extension directories for caching
    private async calculateExtensionHash(mv2Dir: string, mv3Dir: string): Promise<string> {
        const hash = crypto.createHash('md5');

        const addDirToHash = async (dir: string, prefix: string) => {
            const files = await this.listFilesRecursive(dir);
            for (const file of files.sort()) {
                try {
                    const stat = await fs.promises.stat(path.join(dir, file));
                    hash.update(`${prefix}:${file}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`);
                } catch {
                    // Skip files that can't be stat'd
                }
            }
        };

        await addDirToHash(mv2Dir, 'mv2');
        await addDirToHash(mv3Dir, 'mv3');

        return hash.digest('hex');
    }

    // List files recursively in a directory
    private async listFilesRecursive(dir: string, base: string = ''): Promise<string[]> {
        const files: string[] = [];
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const relativePath = base ? path.join(base, entry.name) : entry.name;
            if (entry.isDirectory()) {
                const subFiles = await this.listFilesRecursive(
                    path.join(dir, entry.name),
                    relativePath
                );
                files.push(...subFiles);
            } else if (entry.isFile()) {
                files.push(relativePath);
            }
        }

        return files;
    }

    // Create a tar.gz archive from a directory (returns Buffer) - kept for small directories
    private async createTarGz(dirPath: string): Promise<Buffer> {
        // For small dirs only; otherwise prefer createTarGzToFile
        return new Promise((resolve, reject) => {
            const pack = tar.pack();
            const chunks: Buffer[] = [];

            // Pipe through gzip
            const gzip = zlib.createGzip();

            gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
            gzip.on('end', () => resolve(Buffer.concat(chunks)));
            gzip.on('error', reject);

            pack.pipe(gzip);

            // Add all files to tar asynchronously and finalize
            (async () => {
                try {
                    await this.addDirectoryToTar(pack, dirPath, '');
                    pack.finalize();
                } catch (error) {
                    // Ensure we reject only once
                    try {
                        reject(error);
                    } catch {
                        // no-op
                    }
                }
            })();
        });
    }

    // Create a tar.gz file on disk for large directories to avoid building large buffers in memory
    private async createTarGzToFile(dirPath: string): Promise<string> {
        const tmpPath = path.join(
            os.tmpdir(),
            `extporter_${Date.now()}_${Math.random().toString(36).slice(2)}.tar.gz`
        );

        return new Promise((resolve, reject) => {
            const pack = tar.pack();
            const gzip = zlib.createGzip();
            const outStream = fs.createWriteStream(tmpPath);

            outStream.on('finish', () => resolve(tmpPath));
            outStream.on('error', (err) => reject(err));
            gzip.on('error', (err) => reject(err));

            pack.pipe(gzip).pipe(outStream);

            (async () => {
                try {
                    // Add files to tar (reads files into memory per-file)
                    await this.addDirectoryToTar(pack, dirPath, '');

                    pack.finalize();
                } catch (error) {
                    // Ensure we reject only once
                    try {
                        reject(error);
                    } catch {
                        // no-op
                    }
                }
            })();
        });
    }

    // Recursively add directory contents to tar pack
    private async addDirectoryToTar(
        pack: any,
        basePath: string,
        relativePath: string
    ): Promise<void> {
        const fullPath = relativePath ? path.join(basePath, relativePath) : basePath;
        const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
            const entryFull = path.join(basePath, entryRelative);

            if (entry.isDirectory()) {
                await this.addDirectoryToTar(pack, basePath, entryRelative);
            } else if (entry.isFile()) {
                try {
                    const content = await fs.promises.readFile(entryFull);
                    const stat = await fs.promises.stat(entryFull);

                    // Add entry with proper headers
                    pack.entry(
                        {
                            name: entryRelative,
                            size: content.length,
                            mode: stat.mode,
                            mtime: stat.mtime,
                        },
                        content
                    );
                } catch (error) {
                    console.warn(`[Download] Skipping file ${entryFull}: ${error}`);
                }
            }
        }
    }

    // Build a summary of the manifest
    private buildManifestSummary(ext: any): string {
        const lines: string[] = [];

        if (ext.manifest) {
            const manifest = ext.manifest;

            lines.push(`Manifest Version: ${manifest.manifest_version || 'Unknown'}`);
            lines.push(`Version: ${manifest.version || 'Unknown'}`);

            if (manifest.permissions && manifest.permissions.length > 0) {
                lines.push(`Permissions: ${manifest.permissions.join(', ')}`);
            }

            if (manifest.host_permissions && manifest.host_permissions.length > 0) {
                lines.push(`Host Permissions: ${manifest.host_permissions.join(', ')}`);
            }

            if (manifest.background) {
                if (manifest.background.service_worker) {
                    lines.push(
                        `Background: Service Worker (${manifest.background.service_worker})`
                    );
                } else if (manifest.background.scripts) {
                    lines.push(`Background: Scripts (${manifest.background.scripts.join(', ')})`);
                }
            }

            if (manifest.content_scripts && manifest.content_scripts.length > 0) {
                lines.push(`Content Scripts: ${manifest.content_scripts.length} script(s)`);
            }

            if (manifest.action?.default_popup || manifest.browser_action?.default_popup) {
                const popup =
                    manifest.action?.default_popup || manifest.browser_action?.default_popup;
                lines.push(`Popup: ${popup}`);
            }

            if (manifest.options_page || manifest.options_ui?.page) {
                const options = manifest.options_page || manifest.options_ui?.page;
                lines.push(`Options: ${options}`);
            }
        }

        return lines.join('\n');
    }

    // Get key extension files for LLM context
    private async getExtensionFiles(ext: any): Promise<string> {
        try {
            const files: string[] = [];

            // Prefer MV3 version for analysis
            const manifestPath = ext.manifest_v3_path || ext.manifest_v2_path;
            if (!manifestPath) {
                return 'No source files available';
            }

            const extDir = manifestPath.endsWith('manifest.json')
                ? manifestPath.replace(/\/manifest\.json$/, '')
                : manifestPath;

            // Read key files based on manifest
            const manifest = ext.manifest;
            if (!manifest) {
                return 'No manifest available';
            }

            const filesToRead: string[] = [];

            // Background scripts
            if (manifest.background) {
                if (manifest.background.service_worker) {
                    filesToRead.push(manifest.background.service_worker);
                } else if (manifest.background.scripts) {
                    filesToRead.push(...manifest.background.scripts.slice(0, 2)); // Max 2
                }
            }

            // Content scripts (first one only)
            if (manifest.content_scripts && manifest.content_scripts[0]?.js) {
                filesToRead.push(manifest.content_scripts[0].js[0]);
            }

            // Popup script
            if (manifest.action?.default_popup || manifest.browser_action?.default_popup) {
                const popup =
                    manifest.action?.default_popup || manifest.browser_action?.default_popup;
                filesToRead.push(popup);
            }

            // Read files (max 3 files, 500 lines total)
            let totalLines = 0;
            const maxLines = 500;

            for (const file of filesToRead.slice(0, 3)) {
                if (totalLines >= maxLines) break;

                const filePath = path.join(extDir, file);
                if (fs.existsSync(filePath)) {
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        const lines = content.split('\n');
                        const linesToTake = Math.min(lines.length, maxLines - totalLines);

                        files.push(`\n--- ${file} (${linesToTake} lines) ---`);
                        files.push(lines.slice(0, linesToTake).join('\n'));

                        totalLines += linesToTake;
                    } catch {
                        // Skip files that can't be read
                    }
                }
            }

            return files.length > 0 ? files.join('\n') : 'No readable source files found';
        } catch {
            return 'Error reading source files';
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

    // ==================== Memory Management Methods ====================

    /**
     * Reset the inactivity timeout for a WebSocket connection
     */
    private resetConnectionTimeout(ws: WebSocket): void {
        this.clearConnectionTimeout(ws);
        const timer = setTimeout(() => {
            console.log('Closing inactive WebSocket connection due to timeout');
            try {
                ws.close(1000, 'Inactivity timeout');
            } catch {
                // Connection might already be closed
            }
            this.connectedClients.delete(ws);
            this.connectionTimers.delete(ws);
        }, this.connectionTimeout);
        this.connectionTimers.set(ws, timer);
    }

    /**
     * Clear the inactivity timeout for a WebSocket connection
     */
    private clearConnectionTimeout(ws: WebSocket): void {
        const timer = this.connectionTimers.get(ws);
        if (timer) {
            clearTimeout(timer);
            this.connectionTimers.delete(ws);
        }
    }

    /**
     * Periodic cleanup of stale resources to prevent memory leaks
     */
    private async periodicCleanup(): Promise<void> {
        // Import garbage collection utilities dynamically to avoid circular deps
        const { logMemoryUsage, shouldTriggerGC, forceGarbageCollection } = await import(
            '../../utils/garbage.js'
        );

        // Clean up dead connections from connectedClients
        let deadConnections = 0;
        for (const client of this.connectedClients) {
            if (client.readyState !== WebSocket.OPEN) {
                this.connectedClients.delete(client);
                this.clearConnectionTimeout(client);
                deadConnections++;
            }
        }

        // Clean up stale migrators (processes that have exited)
        let staleMigrators = 0;
        for (const [clientId, migrator] of this.activeMigrators) {
            if (migrator.process && migrator.process.killed) {
                this.activeMigrators.delete(clientId);
                staleMigrators++;
            }
        }

        // Log cleanup stats if anything was cleaned
        if (deadConnections > 0 || staleMigrators > 0) {
            console.log(
                `[Cleanup] Removed ${deadConnections} dead connections, ${staleMigrators} stale migrators`
            );
        }

        // Check memory and trigger GC if needed
        if (shouldTriggerGC(16)) {
            // Trigger at 16GB
            logMemoryUsage('periodic-cleanup-before-gc');
            forceGarbageCollection();
            logMemoryUsage('periodic-cleanup-after-gc');
        }
    }

    // Close the server gracefully
    async close(): Promise<void> {
        // Stop periodic cleanup
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Clear all connection timeouts
        for (const timer of this.connectionTimers.values()) {
            clearTimeout(timer);
        }
        this.connectionTimers.clear();

        // Stop all active migrators
        for (const migrator of this.activeMigrators.values()) {
            if (migrator.process) {
                migrator.process.kill('SIGTERM');
            }
        }
        this.activeMigrators.clear();

        // Clear connected clients
        this.connectedClients.clear();

        // Cleanup LLM manager and SSH tunnel
        if (this.llmInitialized) {
            console.log('Closing SSH tunnel...');
            await llmManager.cleanup();
        }

        // Restore original console methods
        console.log = this.originalConsoleLog;
        console.info = this.originalConsoleInfo;
        console.debug = this.originalConsoleDebug;
        console.error = this.originalConsoleError;
        console.warn = this.originalConsoleWarn;

        this.server.close(() => { });
    }
}
