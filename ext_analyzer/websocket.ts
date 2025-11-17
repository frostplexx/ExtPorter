import WebSocket from 'ws';

export type MessageHandler = (message: string) => void;
export type ConnectionHandler = () => void;
export type ErrorHandler = (error: Error) => void;

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: any) => void;
}

export class ExtensionAnalyzerClient {
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private onMessageCallback?: MessageHandler;
    private onConnectCallback?: ConnectionHandler;
    private onDisconnectCallback?: ConnectionHandler;
    private onErrorCallback?: ErrorHandler;
    private requestId: number = 0;
    private pendingRequests: Map<number, PendingRequest> = new Map();

    constructor(serverUrl: string = 'ws://localhost:8080') {
        this.serverUrl = serverUrl;
    }

    // Set callback for received messages
    onMessage(callback: MessageHandler): void {
        this.onMessageCallback = callback;
    }

    // Set callback for connection established
    onConnect(callback: ConnectionHandler): void {
        this.onConnectCallback = callback;
    }

    // Set callback for disconnection
    onDisconnect(callback: ConnectionHandler): void {
        this.onDisconnectCallback = callback;
    }

    // Set callback for errors
    onError(callback: ErrorHandler): void {
        this.onErrorCallback = callback;
    }

    // Connect to the WebSocket server
    connect(): void {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.on('open', () => {
            if (this.onConnectCallback) {
                this.onConnectCallback();
            }
        });

        this.ws.on('message', (data: Buffer) => {
            const message = data.toString();
            
            // Try to parse as JSON for API responses
            try {
                const jsonMessage = JSON.parse(message);
                if (jsonMessage.type === 'db_response') {
                    const pending = this.pendingRequests.get(jsonMessage.id);
                    if (pending) {
                        this.pendingRequests.delete(jsonMessage.id);
                        if (jsonMessage.error) {
                            pending.reject(new Error(jsonMessage.error));
                        } else {
                            pending.resolve(jsonMessage.result);
                        }
                    }
                    return;
                }
            } catch (e) {
                // Not JSON, pass to message callback
            }

            // Regular message handling
            if (this.onMessageCallback) {
                this.onMessageCallback(message);
            }
        });

        this.ws.on('close', () => {
            // Reject all pending requests
            this.pendingRequests.forEach((pending) => {
                pending.reject(new Error('WebSocket connection closed'));
            });
            this.pendingRequests.clear();

            if (this.onDisconnectCallback) {
                this.onDisconnectCallback();
            }
        });

        this.ws.on('error', (error: Error) => {
            if (this.onErrorCallback) {
                this.onErrorCallback(error);
            }
        });
    }

    // Send a message to the server
    send(message: string): boolean {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
            return true;
        }
        return false;
    }

    // Send a database query and wait for response
    private async query(method: string, params?: any): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        const id = ++this.requestId;
        const request = {
            type: 'db_query',
            id,
            method,
            params: params || {},
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws!.send(JSON.stringify(request));

            // Timeout after 30 seconds
            setTimeout(() => {
                const pending = this.pendingRequests.get(id);
                if (pending) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    // Database API methods
    async getExtensions(): Promise<any[]> {
        return this.query('getExtensions');
    }

    async findExtension(filter: any): Promise<any> {
        return this.query('findExtension', { filter });
    }

    async getCollections(): Promise<any[]> {
        return this.query('getCollections');
    }

    async queryCollection(collection: string, query: any = {}, limit: number = 10): Promise<any[]> {
        return this.query('queryCollection', { collection, query, limit });
    }

    async countDocuments(collection: string, query: any = {}): Promise<number> {
        return this.query('countDocuments', { collection, query });
    }

    async getLogs(limit: number = 50): Promise<any[]> {
        return this.query('getLogs', { limit });
    }

    // Check if connected
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    // Disconnect from the server
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
