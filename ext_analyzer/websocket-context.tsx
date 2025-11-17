import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ExtensionAnalyzerClient } from './websocket.js';
import { MongoClient, Db, ChangeStream } from 'mongodb';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Message {
    type: 'sent' | 'received' | 'system';
    content: string;
    timestamp: Date;
}

interface LogEntry {
    loglevel: string;
    message: string;
    meta: any;
    time: number;
}

interface ExtensionData {
    id: string;
    name: string;
    version: string;
    mv2_extension_id?: string;
    mv3_extension_id?: string;
    tags?: string[];
    originalManifest?: any;
    migratedManifest?: any;
    interestingness?: number;
    files?: any[];
    migration_time_seconds?: number;
    migration_timestamp?: number;
    input_path?: string;
    new_tab_extension?: boolean;
    [key: string]: any;
}

interface WebSocketContextType {
    client: ExtensionAnalyzerClient;
    messages: Message[];
    connectionStatus: 'disconnected' | 'connecting' | 'connected';
    databaseStatus: 'disconnected' | 'connecting' | 'connected';
    migrationStatus: 'running' | 'stopped';
    extensions: ExtensionData[];
    sendMessage: (message: string) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

interface WebSocketProviderProps {
    children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [extensions, setExtensions] = useState<ExtensionData[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<
        'disconnected' | 'connecting' | 'connected'
    >('disconnected');
    const [databaseStatus, setDatabaseStatus] = useState<
        'disconnected' | 'connecting' | 'connected'
    >('disconnected');
    const [migrationStatus, setMigrationStatus] = useState<'running' | 'stopped'>('stopped');
    const [client] = useState(() => new ExtensionAnalyzerClient('ws://localhost:8080'));
    const [reconnectTimer, setReconnectTimer] = useState<NodeJS.Timeout | null>(null);
    const [handlersRegistered, setHandlersRegistered] = useState(false);

    const sendMessage = (message: string) => {
        if (message.trim()) {
            if (client.send(message.trim())) {
                setMessages((prev) => [
                    ...prev,
                    {
                        type: 'sent',
                        content: message.trim(),
                        timestamp: new Date(),
                    },
                ]);
            } else {
                setMessages((prev) => [
                    ...prev,
                    {
                        type: 'system',
                        content: 'Cannot send: Not connected to server',
                        timestamp: new Date(),
                    },
                ]);
            }
        }
    };

    // WebSocket connection effect
    useEffect(() => {
        // Only register handlers once
        if (handlersRegistered) {
            return;
        }

        // Setup WebSocket handlers
        client.onConnect(() => {
            setConnectionStatus('connected');
            // Clear any existing reconnect timer
            setReconnectTimer((prevTimer) => {
                if (prevTimer) {
                    clearTimeout(prevTimer);
                }
                return null;
            });
            setMessages((prev) => [
                ...prev,
                {
                    type: 'system',
                    content: 'Connected to Migration Server',
                    timestamp: new Date(),
                },
            ]);
        });

        client.onDisconnect(() => {
            setConnectionStatus('disconnected');
            setMessages((prev) => [
                ...prev,
                {
                    type: 'system',
                    content: 'Disconnected from migration server',
                    timestamp: new Date(),
                },
            ]);
            // Schedule automatic reconnection attempt after 3 seconds
            setReconnectTimer((prevTimer) => {
                if (prevTimer) {
                    clearTimeout(prevTimer);
                }
                const newTimer = setTimeout(() => {
                    setConnectionStatus('connecting');
                    setMessages((prevMessages) => [
                        ...prevMessages,
                        {
                            type: 'system',
                            content: 'Attempting to reconnect to server...',
                            timestamp: new Date(),
                        },
                    ]);
                    client.connect();
                }, 3000);
                return newTimer;
            });
        });

        client.onError((error: Error) => {
            setMessages((prev) => [
                ...prev,
                {
                    type: 'system',
                    content: `Server Error: ${error.message}`,
                    timestamp: new Date(),
                },
            ]);
        });

        client.onMessage((message: string) => {
            // Check if message contains database status info
            if (message.includes('DB_STATUS:')) {
                const statusMatch = message.match(/DB_STATUS:(\w+)/);
                if (statusMatch) {
                    const dbStatus = statusMatch[1].toLowerCase() as
                        | 'disconnected'
                        | 'connecting'
                        | 'connected';
                    setDatabaseStatus(dbStatus);
                }
                // Don't log DB_STATUS messages to the message list
                return;
            }

            // Check if message contains migration status info
            if (message.includes('MIGRATION_STATUS:')) {
                const statusMatch = message.match(/MIGRATION_STATUS:(\w+)/);
                if (statusMatch) {
                    const migStatus = statusMatch[1].toLowerCase() as 'running' | 'stopped';
                    setMigrationStatus(migStatus);
                }
                // Don't log MIGRATION_STATUS messages to the message list
                return;
            }

            // Check if message is STDOUT or STDERR
            let messageType: 'sent' | 'received' | 'system' = 'received';
            let content = message;

            if (message.startsWith('STDOUT: ')) {
                messageType = 'system';
                content = message.substring(8); // Remove 'STDOUT: ' prefix
            } else if (message.startsWith('STDERR: ')) {
                messageType = 'system';
                content = '⚠ ' + message.substring(8); // Remove 'STDERR: ' prefix and add warning
            }

            // Normalize content to single line (replace newlines and multiple spaces)
            content = content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

            // Log messages
            setMessages((prev) => [
                ...prev,
                {
                    type: messageType,
                    content: content,
                    timestamp: new Date(),
                },
            ]);
        });

        setHandlersRegistered(true);

        // Connect to server after a small delay to ensure UI is ready
        setTimeout(() => {
            setConnectionStatus('connecting');
            setMessages((prev) => [
                ...prev,
                {
                    type: 'system',
                    content: 'Connecting to migration server...',
                    timestamp: new Date(),
                },
            ]);
            client.connect();
        }, 100);

        // Cleanup on unmount
        return () => {
            setReconnectTimer((prevTimer) => {
                if (prevTimer) {
                    clearTimeout(prevTimer);
                }
                return null;
            });
            client.disconnect();
        };
    }, [client, handlersRegistered]);

    // MongoDB connection effect
    useEffect(() => {
        let mongoClient: MongoClient | null = null;
        let db: Db | null = null;
        let logsChangeStream: ChangeStream | null = null;
        let extensionsChangeStream: ChangeStream | null = null;
        let dbReconnectTimer: NodeJS.Timeout | null = null;
        let mounted = true;
        let isCleaningUp = false;

        const connectToMongoDB = async () => {
            if (!mounted || isCleaningUp) return;

            try {
                setDatabaseStatus('connecting');
                if (mounted) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            type: 'system',
                            content: 'Connecting to MongoDB...',
                            timestamp: new Date(),
                        },
                    ]);
                }

                const mongoUri =
                    process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27017/migrator';
                const dbName = process.env.DB_NAME || 'migrator';

                // Connect to MongoDB
                mongoClient = new MongoClient(mongoUri, {
                    serverSelectionTimeoutMS: 5000,
                    connectTimeoutMS: 5000,
                });
                await mongoClient.connect();
                db = mongoClient.db(dbName);

                if (!mounted || isCleaningUp) {
                    await mongoClient.close();
                    return;
                }

                setDatabaseStatus('connected');
                setMessages((prev) => [
                    ...prev,
                    {
                        type: 'system',
                        content: 'Connected to MongoDB',
                        timestamp: new Date(),
                    },
                ]);

                // Fetch initial extensions
                const extensionsCollection = db.collection<ExtensionData>('extensions');
                const initialExtensions = await extensionsCollection.find({}).toArray();
                if (mounted && !isCleaningUp) {
                    setExtensions(initialExtensions as ExtensionData[]);
                    setMessages((prev) => [
                        ...prev,
                        {
                            type: 'system',
                            content: `Loaded ${initialExtensions.length} extensions from database`,
                            timestamp: new Date(),
                        },
                    ]);
                }

                // Fetch initial logs (limited to most recent 50)
                const logsCollection = db.collection<LogEntry>('logs');
                const initialLogs = await logsCollection
                    .find({})
                    .sort({ time: -1 })
                    .limit(50)
                    .toArray();

                // Convert logs to messages
                const logMessages: Message[] = initialLogs.reverse().map((log) => {
                    let content = log.message;

                    // Add extension name if available
                    if (log.meta?.extension?.name) {
                        content = `[${log.meta.extension.name}] ${content}`;
                    }

                    // Format based on log level
                    const levelPrefix = `[${log.loglevel.toUpperCase()}]`;
                    content = `${levelPrefix} ${content}`;

                    return {
                        type: 'system' as const,
                        content,
                        timestamp: new Date(log.time),
                    };
                });

                if (mounted && !isCleaningUp && logMessages.length > 0) {
                    setMessages((prev) => [...prev, ...logMessages]);
                }

                // Watch for changes in extensions collection
                extensionsChangeStream = extensionsCollection.watch([], {
                    fullDocument: 'updateLookup',
                });

                extensionsChangeStream.on('change', (change) => {
                    if (!mounted || isCleaningUp) return;

                    if (
                        change.operationType === 'insert' ||
                        change.operationType === 'update' ||
                        change.operationType === 'replace'
                    ) {
                        const updatedDoc = change.fullDocument as ExtensionData;
                        if (updatedDoc) {
                            setExtensions((prev) => {
                                const existingIndex = prev.findIndex(
                                    (ext) => ext.id === updatedDoc.id
                                );
                                if (existingIndex >= 0) {
                                    const updated = [...prev];
                                    updated[existingIndex] = updatedDoc;
                                    return updated;
                                } else {
                                    return [...prev, updatedDoc];
                                }
                            });
                        }
                    } else if (change.operationType === 'delete') {
                        const deletedId = change.documentKey._id;
                        setExtensions((prev) =>
                            prev.filter((ext) => (ext as any)._id !== deletedId)
                        );
                    }
                });

                extensionsChangeStream.on('error', (error) => {
                    if (!isCleaningUp) {
                        console.error('Extensions change stream error:', error);
                        setMessages((prev) => [
                            ...prev,
                            {
                                type: 'system',
                                content: `Database stream error: ${error.message}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                });

                // Watch for new logs
                logsChangeStream = logsCollection.watch([], { fullDocument: 'updateLookup' });

                logsChangeStream.on('change', (change) => {
                    if (!mounted || isCleaningUp) return;

                    if (change.operationType === 'insert') {
                        const newLog = change.fullDocument as LogEntry;
                        if (newLog) {
                            let content = newLog.message;

                            // Add extension name if available
                            if (newLog.meta?.extension?.name) {
                                content = `[${newLog.meta.extension.name}] ${content}`;
                            }

                            // Format based on log level
                            const levelPrefix = `[${newLog.loglevel.toUpperCase()}]`;
                            content = `${levelPrefix} ${content}`;

                            setMessages((prev) => [
                                ...prev,
                                {
                                    type: 'system',
                                    content,
                                    timestamp: new Date(newLog.time),
                                },
                            ]);
                        }
                    }
                });

                logsChangeStream.on('error', (error) => {
                    if (!isCleaningUp) {
                        console.error('Logs change stream error:', error);
                    }
                });
            } catch (error) {
                if (!isCleaningUp) {
                    console.error('MongoDB connection error:', error);
                    setDatabaseStatus('disconnected');
                    if (mounted) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                type: 'system',
                                content: `Database connection failed: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    // Schedule reconnection attempt after 5 seconds
                    if (mounted) {
                        dbReconnectTimer = setTimeout(() => {
                            if (mounted && !isCleaningUp) {
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        type: 'system',
                                        content: 'Attempting to reconnect to database...',
                                        timestamp: new Date(),
                                    },
                                ]);
                                connectToMongoDB();
                            }
                        }, 5000);
                    }
                }
            }
        };

        connectToMongoDB();

        // Cleanup on unmount
        return () => {
            mounted = false;
            isCleaningUp = true;

            if (dbReconnectTimer) {
                clearTimeout(dbReconnectTimer);
            }
            if (logsChangeStream) {
                logsChangeStream.close().catch(() => {});
            }
            if (extensionsChangeStream) {
                extensionsChangeStream.close().catch(() => {});
            }
            if (mongoClient) {
                mongoClient.close().catch(() => {});
            }
        };
    }, []);

    const contextValue: WebSocketContextType = {
        client,
        messages,
        connectionStatus,
        databaseStatus,
        migrationStatus,
        extensions,
        sendMessage,
    };

    return <WebSocketContext.Provider value={contextValue}>{children}</WebSocketContext.Provider>;
};

export const useWebSocket = (): WebSocketContextType => {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
};
