/**
 * API extraction utilities
 */

import { Extension } from '../../migrator/types/extension';
import { ChromeAPIUsage } from './types';
import { ALL_CHROME_APIS } from './api_patterns';

/**
 * Extract Chrome API usage from an extension
 */
export function extractAPIUsage(extension: Extension): ChromeAPIUsage {
    const apiUsage: ChromeAPIUsage = {};

    // Initialize all APIs to 0
    ALL_CHROME_APIS.forEach((api) => {
        apiUsage[api] = 0;
    });

    // Count API occurrences in all JavaScript files
    for (const file of extension.files) {
        try {
            const content = file.getContent();

            // Count each API pattern
            for (const api of ALL_CHROME_APIS) {
                // Escape dots for regex
                const pattern = api.replace(/\./g, '\\.');
                const regex = new RegExp(pattern, 'g');
                const matches = content.match(regex);
                if (matches) {
                    apiUsage[api] += matches.length;
                }
            }
        } catch (error) {
            // Skip files that can't be read
            continue;
        }
    }

    return apiUsage;
}

/**
 * Convert API usage to feature vector for clustering
 */
export function apiUsageToVector(apiUsage: ChromeAPIUsage, useLogScale: boolean = true): number[] {
    const vector: number[] = [];

    for (const api of ALL_CHROME_APIS) {
        const count = apiUsage[api] || 0;

        if (useLogScale) {
            // Log scale: log(count + 1) to handle 0 values
            vector.push(Math.log(count + 1));
        } else {
            vector.push(count);
        }
    }

    return vector;
}

/**
 * Normalize a vector (L2 normalization)
 */
export function normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map((val) => val / magnitude);
}

/**
 * Calculate cosine similarity between two API usage patterns
 */
export function calculateCosineSimilarity(usage1: ChromeAPIUsage, usage2: ChromeAPIUsage): number {
    const vector1 = normalizeVector(apiUsageToVector(usage1));
    const vector2 = normalizeVector(apiUsageToVector(usage2));

    const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
    return dotProduct;
}

/**
 * Get the top N most used APIs from usage data
 */
export function getTopAPIs(
    apiUsage: ChromeAPIUsage,
    n: number = 10
): Array<{ api: string; count: number }> {
    return Object.entries(apiUsage)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([api, count]) => ({ api, count }));
}

/**
 * Get all used APIs (with count > 0)
 */
export function getUsedAPIs(apiUsage: ChromeAPIUsage): string[] {
    return Object.entries(apiUsage)
        .filter(([_, count]) => count > 0)
        .map(([api, _]) => api);
}
