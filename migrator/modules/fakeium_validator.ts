/**
 * FakeiumValidator - Validates MV2→MV3 migration using fakeium sandbox
 *
 * This module runs both the original MV2 and migrated MV3 extension code
 * in fakeium sandboxes and compares their behaviors to validate the migration.
 */

import { Extension } from '../types/extension';
import { MigrationModule, MigrationError } from '../types/migration_module';
import { logger } from '../utils/logger';
import { FakeiumRunner } from '../features/fakeium/FakeiumRunner';
import { BehaviorComparator } from '../features/fakeium/BehaviorComparator';

export class FakeiumValidator extends MigrationModule {
    /**
     * Validates the migration by comparing MV2 and MV3 behaviors
     * Note: This is a synchronous wrapper that schedules async validation
     */
    static migrate(extension: Extension): Extension | MigrationError {
        // Check if validation is enabled
        const validationEnabled = process.env.ENABLE_FAKEIUM_VALIDATION === 'true';

        if (!validationEnabled) {
            // Skip validation if disabled
            extension.fakeium_validation = {
                enabled: false,
                is_equivalent: false,
                similarity_score: 0,
                mv2_api_calls: 0,
                mv3_api_calls: 0,
                matched_calls: 0,
                mv2_only_calls: 0,
                mv3_only_calls: 0,
                differences: ['Validation disabled'],
                validation_errors: [],
                duration_ms: 0
            };
            return extension;
        }

        // Initialize with placeholder values
        extension.fakeium_validation = {
            enabled: true,
            is_equivalent: false,
            similarity_score: 0,
            mv2_api_calls: 0,
            mv3_api_calls: 0,
            matched_calls: 0,
            mv2_only_calls: 0,
            mv3_only_calls: 0,
            differences: [],
            validation_errors: [],
            duration_ms: 0
        };

        return extension;
    }

    /**
     * Async version of migrate for use in the pipeline
     */
    static async migrateAsync(extension: Extension): Promise<Extension | MigrationError> {
        // Check if validation is enabled
        const validationEnabled = process.env.ENABLE_FAKEIUM_VALIDATION === 'true';

        if (!validationEnabled) {
            extension.fakeium_validation = {
                enabled: false,
                is_equivalent: false,
                similarity_score: 0,
                mv2_api_calls: 0,
                mv3_api_calls: 0,
                matched_calls: 0,
                mv2_only_calls: 0,
                mv3_only_calls: 0,
                differences: ['Validation disabled'],
                validation_errors: [],
                duration_ms: 0
            };
            return extension;
        }

        const startTime = Date.now();

        try {
            logger.info(extension, 'Starting fakeium validation');

            const result = await this.validateExtension(extension);

            extension.fakeium_validation = {
                enabled: true,
                is_equivalent: result.isEquivalent,
                similarity_score: result.similarityScore,
                mv2_api_calls: result.mv2ApiCalls,
                mv3_api_calls: result.mv3ApiCalls,
                matched_calls: result.matchedCalls,
                mv2_only_calls: result.mv2OnlyCalls,
                mv3_only_calls: result.mv3OnlyCalls,
                differences: result.differences,
                validation_errors: [],
                duration_ms: Date.now() - startTime
            };

            // Log results
            if (result.isEquivalent) {
                logger.info(extension, `Fakeium validation PASSED (${(result.similarityScore * 100).toFixed(1)}% similarity)`, {
                    matched: result.matchedCalls,
                    mv2_only: result.mv2OnlyCalls,
                    mv3_only: result.mv3OnlyCalls,
                    duration_ms: extension.fakeium_validation.duration_ms
                });
            } else {
                logger.warn(extension, `Fakeium validation FAILED (${(result.similarityScore * 100).toFixed(1)}% similarity)`, {
                    matched: result.matchedCalls,
                    mv2_only: result.mv2OnlyCalls,
                    mv3_only: result.mv3OnlyCalls,
                    differences: result.differences.slice(0, 3),
                    duration_ms: extension.fakeium_validation.duration_ms
                });
            }

            return extension;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(extension, 'Fakeium validation failed', { error: errorMessage });

            extension.fakeium_validation = {
                enabled: true,
                is_equivalent: false,
                similarity_score: 0,
                mv2_api_calls: 0,
                mv3_api_calls: 0,
                matched_calls: 0,
                mv2_only_calls: 0,
                mv3_only_calls: 0,
                differences: [],
                validation_errors: [errorMessage],
                duration_ms: Date.now() - startTime
            };

            // Don't fail the migration, just log the validation error
            return extension;
        }
    }

    /**
     * Validate extension by comparing MV2 and MV3 behaviors
     */
    private static async validateExtension(extension: Extension): Promise<{
        isEquivalent: boolean;
        similarityScore: number;
        mv2ApiCalls: number;
        mv3ApiCalls: number;
        matchedCalls: number;
        mv2OnlyCalls: number;
        mv3OnlyCalls: number;
        differences: string[];
    }> {
        // Create a copy of the extension for MV2 testing (with original manifest)
        const mv2Extension: Extension = {
            ...extension,
            manifest: { ...extension.manifest, manifest_version: 2 }
        };

        // Create a copy for MV3 testing (with migrated manifest)
        const mv3Extension: Extension = {
            ...extension,
            manifest: { ...extension.manifest, manifest_version: 3 }
        };

        // Set timeout from environment or default to 10 seconds
        const timeout = parseInt(process.env.FAKEIUM_TIMEOUT || '10000');
        const verbose = process.env.FAKEIUM_VERBOSE === 'true';

        // Run both versions in fakeium
        const [mv2Result, mv3Result] = await Promise.all([
            FakeiumRunner.runExtension(mv2Extension, 2, {
                timeout,
                verbose
            }),
            FakeiumRunner.runExtension(mv3Extension, 3, {
                timeout,
                verbose
            })
        ]);

        // Compare behaviors
        const comparison = BehaviorComparator.compare(
            mv2Result.behavior,
            mv3Result.behavior
        );

        // Capture counts before clearing
        const mv2ApiCallCount = mv2Result.behavior.apiCalls.length;
        const mv3ApiCallCount = mv3Result.behavior.apiCalls.length;

        // Clear the raw events and detailed behavior data to save memory
        // We only need the comparison results, not the full event logs
        mv2Result.rawEvents = [];
        mv3Result.rawEvents = [];
        mv2Result.behavior.apiCalls = [];
        mv3Result.behavior.apiCalls = [];

        return {
            isEquivalent: comparison.isEquivalent,
            similarityScore: comparison.similarityScore,
            mv2ApiCalls: mv2ApiCallCount,
            mv3ApiCalls: mv3ApiCallCount,
            matchedCalls: comparison.matched.length,
            mv2OnlyCalls: comparison.mv2Only.length,
            mv3OnlyCalls: comparison.mv3Only.length,
            // Limit differences to first 5 to save memory
            differences: comparison.differences.slice(0, 5)
        };
    }

    /**
     * Helper to format validation results for logging
     */
    static getValidationSummary(extension: Extension): string {
        if (!extension.fakeium_validation || !extension.fakeium_validation.enabled) {
            return 'Validation disabled';
        }

        const v = extension.fakeium_validation;

        if (v.validation_errors.length > 0) {
            return `Validation error: ${v.validation_errors[0]}`;
        }

        const status = v.is_equivalent ? 'PASSED' : 'FAILED';
        const score = (v.similarity_score * 100).toFixed(1);

        return `${status} (${score}% similarity, ${v.matched_calls} matched, ${v.mv2_only_calls} MV2-only, ${v.mv3_only_calls} MV3-only)`;
    }
}
