import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ExtensionAnalyzerClient } from './websocket.js';

interface Message {
    type: 'sent' | 'received' | 'system';
    content: string;
    timestamp: Date;
}

interface WebSocketContextType {
    client: ExtensionAnalyzerClient;
    messages: Message[];
    connectionStatus: 'disconnected' | 'connecting' | 'connected';
    databaseStatus: 'disconnected' | 'connecting' | 'connected';
    sendMessage: (message: string) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

interface WebSocketProviderProps {
    children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<
        'disconnected' | 'connecting' | 'connected'
    >('disconnected');
    const [databaseStatus, setDatabaseStatus] = useState<
        'disconnected' | 'connecting' | 'connected'
    >('disconnected');
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
                        content: 'Cannot send: Not connected',
                        timestamp: new Date(),
                    },
                ]);
            }
        }
    };

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
                    content: 'Disconnected from server',
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
                            content: 'Attempting to reconnect...',
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
                    content: `Error: ${error.message}`,
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

            // Log regular messages
            setMessages((prev) => [
                ...prev,
                {
                    type: 'received',
                    content: message,
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
                    content: 'Connecting to server...',
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

    const contextValue: WebSocketContextType = {
        client,
        messages,
        connectionStatus,
        databaseStatus,
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
