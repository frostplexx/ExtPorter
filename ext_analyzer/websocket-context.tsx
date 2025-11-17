import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ExtensionAnalyzerClient } from './websocket.js';
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
    const [pollTimer, setPollTimer] = useState<NodeJS.Timeout | null>(null);

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

    // Function to load extensions from server
    const loadExtensionsFromServer = async () => {
        if (!client.isConnected()) {
            return;
        }

        try {
            const extensionsData = await client.getExtensions();
            setExtensions(extensionsData as ExtensionData[]);
            setDatabaseStatus('connected');
        } catch (error) {
            console.error('Failed to load extensions:', error);
            setDatabaseStatus('disconnected');
        }
    };

    // Function to load logs from server
    const loadLogsFromServer = async () => {
        if (!client.isConnected()) {
            return;
        }

        try {
            const logsData = await client.getLogs(50);
            
            // Convert logs to messages
            const logMessages: Message[] = logsData.reverse().map((log: LogEntry) => {
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

            if (logMessages.length > 0) {
                setMessages((prev) => [...prev, ...logMessages]);
            }
        } catch (error) {
            console.error('Failed to load logs:', error);
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

            // Load initial data from server
            loadExtensionsFromServer();
            loadLogsFromServer();

            // Start polling for updates every 5 seconds
            const timer = setInterval(() => {
                loadExtensionsFromServer();
            }, 5000);
            setPollTimer(timer);
        });

        client.onDisconnect(() => {
            setConnectionStatus('disconnected');
            setDatabaseStatus('disconnected');
            
            // Clear poll timer
            setPollTimer((prevTimer) => {
                if (prevTimer) {
                    clearInterval(prevTimer);
                }
                return null;
            });

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
            setPollTimer((prevTimer) => {
                if (prevTimer) {
                    clearInterval(prevTimer);
                }
                return null;
            });
            client.disconnect();
        };
    }, [client, handlersRegistered]);

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
