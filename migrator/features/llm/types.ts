export interface LLMConfig {
    endpoint: string;
    model: string;
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
}

export interface SSHConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    remotePort: number;
    localPort: number;
}

export interface RemoteLLMConfig extends LLMConfig {
    ssh?: SSHConfig;
}

export interface CommandResult {
    success: boolean;
    output: string;
    error?: string;
}
