import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger';

/**
 * GitHub Copilot OAuth token (gu_ token) and session token management
 * Based on the authentication flow from CopilotChat.nvim
 */

interface CopilotSessionToken {
    token: string;
    expires_at: number;
}

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

interface OAuthTokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
}

// Cache for session tokens
let sessionTokenCache: CopilotSessionToken | null = null;
let oauthTokenCache: string | null = null;

// GitHub Copilot OAuth Client ID (same as used by VS Code and CopilotChat.nvim)
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

/**
 * Get the config path for github-copilot credentials
 */
function getGitHubCopilotConfigPath(): string {
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig && fs.existsSync(xdgConfig)) {
        return xdgConfig;
    }

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData && fs.existsSync(localAppData)) {
            return localAppData;
        }
        return path.join(os.homedir(), 'AppData', 'Local');
    }

    return path.join(os.homedir(), '.config');
}

/**
 * Try to load OAuth token from cached files (created by VS Code, GitHub CLI, etc.)
 */
function loadCachedOAuthToken(): string | null {
    const configPath = getGitHubCopilotConfigPath();
    const filePaths = [
        path.join(configPath, 'github-copilot', 'hosts.json'),
        path.join(configPath, 'github-copilot', 'apps.json'),
    ];

    for (const filePath of filePaths) {
        try {
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(fileContent);

                for (const [key, value] of Object.entries(data)) {
                    if (
                        key.includes('github.com') &&
                        value &&
                        typeof value === 'object' &&
                        'oauth_token' in value
                    ) {
                        const token = (value as { oauth_token: string }).oauth_token;
                        logger.info(null, `Found cached OAuth token in ${filePath}`);
                        return token;
                    }
                }
            }
        } catch (error) {
            logger.debug(null, `Failed to read ${filePath}: ${error}`);
        }
    }

    return null;
}

/**
 * Make an HTTPS request and return a promise with the response
 */
function httpsRequest<T>(
    url: string,
    options: https.RequestOptions,
    body?: string
): Promise<{ statusCode: number; body: T }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions: https.RequestOptions = {
            ...options,
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data) as T;
                    resolve({ statusCode: res.statusCode || 0, body: parsed });
                } catch {
                    reject(new Error(`Failed to parse response: ${data}`));
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * Request a device code for GitHub OAuth device flow
 */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
    const body = new URLSearchParams({
        client_id: COPILOT_CLIENT_ID,
        scope: '',
    }).toString();

    const response = await httpsRequest<DeviceCodeResponse>(
        'https://github.com/login/device/code',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                'Content-Length': Buffer.byteLength(body).toString(),
            },
        },
        body
    );

    if (response.statusCode !== 200) {
        throw new Error(`Failed to request device code: ${JSON.stringify(response.body)}`);
    }

    return response.body;
}

/**
 * Poll for the OAuth access token
 */
async function pollForAccessToken(deviceCode: string, interval: number): Promise<string> {
    const body = new URLSearchParams({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString();

    // Wait for the specified interval
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await httpsRequest<OAuthTokenResponse>(
        'https://github.com/login/oauth/access_token',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                'Content-Length': Buffer.byteLength(body).toString(),
            },
        },
        body
    );

    const data = response.body;

    if (data.access_token) {
        return data.access_token;
    } else if (data.error === 'authorization_pending') {
        // Keep polling
        return pollForAccessToken(deviceCode, interval);
    } else if (data.error === 'slow_down') {
        // Increase interval and keep polling
        return pollForAccessToken(deviceCode, interval + 5);
    } else {
        throw new Error(
            `OAuth error: ${data.error} - ${data.error_description || 'Unknown error'}`
        );
    }
}

/**
 * Perform GitHub device flow authentication
 */
async function performDeviceFlow(): Promise<string> {
    logger.info(null, 'Starting GitHub Copilot device flow authentication...');

    const deviceCode = await requestDeviceCode();

    console.log('\n' + '='.repeat(60));
    console.log('GitHub Copilot Authentication Required');
    console.log('='.repeat(60));
    console.log(`\nPlease visit: ${deviceCode.verification_uri}`);
    console.log(`And enter code: ${deviceCode.user_code}`);
    console.log('\nWaiting for authorization...\n');

    const token = await pollForAccessToken(deviceCode.device_code, deviceCode.interval);

    // Save the token for future use
    saveCachedOAuthToken(token);

    logger.info(null, 'GitHub Copilot authentication successful!');
    return token;
}

/**
 * Save OAuth token to the cache file
 */
function saveCachedOAuthToken(token: string): void {
    const configPath = getGitHubCopilotConfigPath();
    const copilotDir = path.join(configPath, 'github-copilot');
    const hostsFile = path.join(copilotDir, 'hosts.json');

    try {
        // Create directory if it doesn't exist
        if (!fs.existsSync(copilotDir)) {
            fs.mkdirSync(copilotDir, { recursive: true });
        }

        // Load existing data or create new
        let data: Record<string, unknown> = {};
        if (fs.existsSync(hostsFile)) {
            try {
                data = JSON.parse(fs.readFileSync(hostsFile, 'utf-8'));
            } catch {
                data = {};
            }
        }

        // Save token
        data['github.com'] = { oauth_token: token };
        fs.writeFileSync(hostsFile, JSON.stringify(data, null, 2));

        logger.info(null, `OAuth token saved to ${hostsFile}`);
    } catch (error) {
        logger.warn(null, `Failed to save OAuth token: ${error}`);
    }
}

/**
 * Get the GitHub OAuth token (gu_ token)
 * Tries cached token first, then falls back to device flow
 */
export async function getGitHubOAuthToken(): Promise<string> {
    // Check memory cache first
    if (oauthTokenCache) {
        return oauthTokenCache;
    }

    // Check environment variable (for GitHub Codespaces)
    if (process.env.CODESPACES && process.env.GITHUB_TOKEN) {
        oauthTokenCache = process.env.GITHUB_TOKEN;
        return oauthTokenCache;
    }

    // Try to load from cached files
    const cachedToken = loadCachedOAuthToken();
    if (cachedToken) {
        oauthTokenCache = cachedToken;
        return cachedToken;
    }

    // Fall back to device flow
    const token = await performDeviceFlow();
    oauthTokenCache = token;
    return token;
}

/**
 * Exchange OAuth token for a Copilot session token
 */
export async function getCopilotSessionToken(): Promise<string> {
    // Check if we have a valid cached session token
    if (sessionTokenCache && sessionTokenCache.expires_at > Date.now() / 1000 + 60) {
        return sessionTokenCache.token;
    }

    // Get the OAuth token
    const oauthToken = await getGitHubOAuthToken();

    // Exchange for session token
    const response = await httpsRequest<CopilotSessionToken>(
        'https://api.github.com/copilot_internal/v2/token',
        {
            method: 'GET',
            headers: {
                Authorization: `Token ${oauthToken}`,
                Accept: 'application/json',
                'User-Agent': 'ExtPorter-LLM-Client/1.0',
            },
        }
    );

    if (response.statusCode !== 200) {
        // If we get a 401/403, the OAuth token might be invalid - clear cache and retry
        if (response.statusCode === 401 || response.statusCode === 403) {
            oauthTokenCache = null;
            sessionTokenCache = null;
            throw new Error(
                `GitHub Copilot authentication failed. Your OAuth token may be invalid or expired. ` +
                    `Please delete ~/.config/github-copilot/hosts.json and try again to re-authenticate.`
            );
        }
        throw new Error(
            `Failed to get Copilot session token: ${response.statusCode} - ${JSON.stringify(response.body)}`
        );
    }

    sessionTokenCache = response.body;
    logger.debug(
        null,
        `Got Copilot session token, expires at ${new Date(sessionTokenCache.expires_at * 1000).toISOString()}`
    );

    return sessionTokenCache.token;
}

/**
 * Get the required headers for Copilot API requests
 */
export async function getCopilotHeaders(): Promise<Record<string, string>> {
    const sessionToken = await getCopilotSessionToken();

    return {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
        'Editor-Version': 'ExtPorter/1.0.0',
        'Editor-Plugin-Version': 'ExtPorter-LLM-Client/1.0',
        'Copilot-Integration-Id': 'vscode-chat',
        'User-Agent': 'ExtPorter-LLM-Client/1.0',
    };
}

/**
 * Clear all cached tokens (useful for re-authentication)
 */
export function clearTokenCache(): void {
    oauthTokenCache = null;
    sessionTokenCache = null;
    logger.info(null, 'Token cache cleared');
}
