import WebSocket from 'ws';

export type MessageHandler = (message: string) => void;
export type ConnectionHandler = () => void;
export type ErrorHandler = (error: Error) => void;

export class ExtensionAnalyzerClient {
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private onMessageCallback?: MessageHandler;
    private onConnectCallback?: ConnectionHandler;
    private onDisconnectCallback?: ConnectionHandler;
    private onErrorCallback?: ErrorHandler;

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
            if (this.onMessageCallback) {
                this.onMessageCallback(data.toString());
            }
        });

        this.ws.on('close', () => {
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
