/**
 * Type definitions for the extension clustering system
 */

export interface ChromeAPIUsage {
    [apiNamespace: string]: number;
}

export type ExtensionSource = 'filesystem' | 'database' | 'migrated_output';
export type ManifestVersion = 2 | 3;

export interface ExtensionMetadata {
    id: string;
    name: string;
    source: ExtensionSource;
    manifestVersion: ManifestVersion;
    path?: string;

    // API usage
    apiUsage: ChromeAPIUsage;
    totalApiCalls: number;
    uniqueApisUsed: number;

    // File info
    totalFiles: number;
    jsFileCount: number;
    totalFileSize: number;

    // Metadata from database
    tags?: string[];
    interestingnessScore?: number;
    migrationComplexity?: 'simple' | 'moderate' | 'complex' | 'very_complex';

    // Timestamps
    createdAt?: Date;
    migratedAt?: Date;
}

export interface ClusterInfo {
    clusterId: number;
    extensions: ExtensionMetadata[];
    centroid: number[];
    commonAPIs: string[];
    clusterSize: number;

    // Statistics
    avgApiCalls: number;
    avgFileSize: number;
    manifestVersionBreakdown: {
        mv2: number;
        mv3: number;
    };
    sourceBreakdown: {
        filesystem: number;
        database: number;
        migrated_output: number;
    };
}

export interface ClusteringOptions {
    numberOfClusters: number;
    maxIterations?: number;
    initializationMethod?: 'kmeans++' | 'random' | 'mostDistant';
    useLogScale?: boolean;
    normalizeVectors?: boolean;
}

export interface FilterCriteria {
    // Basic filters
    sources?: ExtensionSource[];
    manifestVersions?: ManifestVersion[];
    minApiCalls?: number;
    maxApiCalls?: number;

    // API filters
    requiredApis?: string[]; // Must have ALL of these
    anyOfApis?: string[]; // Must have at least ONE of these
    excludeApis?: string[]; // Must NOT have any of these

    // Tag filters
    requiredTags?: string[];
    excludeTags?: string[];

    // Size filters
    minFileCount?: number;
    maxFileCount?: number;
    minTotalSize?: number;
    maxTotalSize?: number;

    // Complexity filters
    migrationComplexity?: ('simple' | 'moderate' | 'complex' | 'very_complex')[];
    minInterestingnessScore?: number;
    maxInterestingnessScore?: number;

    // Name/ID filters
    nameContains?: string;
    idContains?: string;
}

export interface ComparisonResult {
    extensionId: string;
    extensionName: string;

    // Version comparison
    mv2Version?: ExtensionMetadata;
    mv3Version?: ExtensionMetadata;

    // API changes
    apisAdded: string[];
    apisRemoved: string[];
    apisUnchanged: string[];
    apiCallDifference: number;

    // Complexity
    migrationComplexity: 'simple' | 'moderate' | 'complex' | 'very_complex';

    // Cluster changes
    mv2ClusterId?: number;
    mv3ClusterId?: number;
    clusterChanged: boolean;
}

export interface ClusteringStats {
    totalExtensions: number;

    sourceBreakdown: {
        filesystem: number;
        database: number;
        migrated_output: number;
    };

    manifestVersionBreakdown: {
        mv2: number;
        mv3: number;
    };

    apiStats: {
        mostUsedApis: Array<{ api: string; count: number; percentage: number }>;
        leastUsedApis: Array<{ api: string; count: number; percentage: number }>;
        averageApisPerExtension: number;
        averageCallsPerExtension: number;
    };

    clusterStats: {
        numberOfClusters: number;
        largestCluster: number;
        smallestCluster: number;
        averageClusterSize: number;
    };

    sizeStats: {
        averageFileCount: number;
        averageTotalSize: number;
        largestExtension: { id: string; size: number };
        smallestExtension: { id: string; size: number };
    };
}

export interface ExportFormat {
    format: 'json' | 'csv' | 'html';
    includeRawData?: boolean;
    includeStatistics?: boolean;
    includeClusters?: boolean;
}

export interface APICooccurrence {
    api1: string;
    api2: string;
    cooccurrenceCount: number;
    percentage: number;
}

// Additional types for clustering scripts
export interface APIUsage {
    [api: string]: number;
}

export interface ExtensionData {
    id: string;
    name: string;
    source: 'filesystem' | 'database' | 'output';
    manifestVersion: number;
    baseApiUsage: APIUsage; // e.g., chrome.tabs
    fullApiUsage: APIUsage; // e.g., chrome.tabs.query
    totalApiCalls: number;
}

export interface ClusterResult {
    clusterId: number;
    clusterName: string;
    extensions: ExtensionData[];
    centroid: number[];
    commonAPIs: string[];
}

export interface APIDomainStats {
    domain: string;
    apis: Array<{
        api: string;
        extensionCount: number;
        totalCalls: number;
        needsMigration: boolean;
    }>;
    totalExtensions: number;
    totalCalls: number;
    unmigrated: number;
}

export interface MigrationInfo {
    mv2API: string;
    mv3API: string | null;
    status: 'deprecated' | 'limited' | 'removed' | 'changed';
    autoMigratable: boolean;
}
