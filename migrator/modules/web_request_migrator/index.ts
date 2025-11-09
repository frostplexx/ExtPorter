import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { Tags } from '../../types/tags';
import { Rule } from '../../types/dnr_rule_types';
import { findWebRequestUsages } from './usage-detector';
import { analyzeWebRequestUsage } from './usage-analyzer';
import { convertToStaticRules, createRulesFile } from './rule-generator';
import { transformWebRequestFiles } from './file-transformer';

/**
 * Migration module that converts blocking chrome.webRequest API calls to chrome.declarativeNetRequest.
 *
 * Scope:
 * - Only migrates BLOCK/REDIRECT actions from onBeforeRequest events with "blocking" in extraInfoSpec.
 * - Does NOT migrate header/auth events (onBeforeSendHeaders, onHeadersReceived, onAuthRequired) or modify headers.
 * - Non-blocking webRequest listeners (observational only) are left unchanged.
 * - Manifest changes (e.g., DNR configuration) are performed in a separate module (MigrateManifest).
 *
 * This module analyzes blocking onBeforeRequest usage and:
 * 1. Identifies static patterns that can be converted to DNR rules
 * 2. Detects dynamic logic that may require updateDynamicRules or marks migration as failed
 * 3. Generates rules.json file with static rules
 */
export class WebRequestMigrator implements MigrationModule {
    static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        const startTime = Date.now();

        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Find all blocking webRequest usages
            const webRequestUsages = findWebRequestUsages(extension);

            if (webRequestUsages.length === 0) {
                logger.debug(extension, 'No blocking webRequest usage found');
                return extension;
            }

            logger.info(extension, `Found ${webRequestUsages.length} blocking webRequest usage(s)`);

            // Analyze each usage to determine if it can be migrated
            const staticRules: Rule[] = [];

            for (const usage of webRequestUsages) {
                const analysis = analyzeWebRequestUsage(usage);

                if (analysis.hasDynamicLogic) {
                    // Migration must fail - dynamic logic that cannot be converted
                    logger.error(
                        extension,
                        `Cannot migrate blocking webRequest usage with dynamic logic: ${usage.eventType}`,
                        {
                            file: usage.file.path,
                            reason: analysis.reason,
                        }
                    );
                    return new MigrationError(
                        extension,
                        new Error(
                            `Blocking webRequest migration failed: ${usage.eventType} in ${usage.file.path} contains non-migratable dynamic logic: ${analysis.reason}`
                        )
                    );
                } else {
                    // Static pattern - convert to DNR rules (may generate multiple rules for multiple URL patterns)
                    const rules = convertToStaticRules(usage, extension);
                    staticRules.push(...rules);
                }
            }

            // Transform JavaScript files to comment out migrated webRequest calls
            let finalFiles = transformWebRequestFiles(extension, webRequestUsages);

            // Create rules.json file if we have static rules
            if (staticRules.length > 0) {
                const rulesFile = createRulesFile(staticRules);
                finalFiles = [...finalFiles, rulesFile];
                logger.info(extension, `Generated ${staticRules.length} static DNR rule(s)`);
            }

            const duration = Date.now() - startTime;
            logger.info(
                extension,
                'Blocking webRequest to declarativeNetRequest migration completed',
                {
                    staticRules: staticRules.length,
                    duration,
                }
            );

            // Update interestingness_breakdown.webRequest_to_dnr_migrations if static rules were generated
            const updatedBreakdown = extension.interestingness_breakdown
                ? { ...extension.interestingness_breakdown }
                : undefined;
            if (staticRules.length > 0 && updatedBreakdown) {
                if (typeof updatedBreakdown.webRequest_to_dnr_migrations === 'number') {
                    updatedBreakdown.webRequest_to_dnr_migrations += 1;
                } else {
                    updatedBreakdown.webRequest_to_dnr_migrations = 1;
                }
            }

            // Prepare updated extension object
            const updatedExtension = {
                ...extension,
                files: finalFiles,
                ...(updatedBreakdown && { interestingness_breakdown: updatedBreakdown }),
            };

            // Add DECLARATIVE_NET_REQUEST_MIGRATED tag if rules were generated
            if (staticRules.length > 0) {
                if (!updatedExtension.tags) {
                    updatedExtension.tags = [];
                }
                const dnrTag = Tags[Tags.DECLARATIVE_NET_REQUEST_MIGRATED];
                if (!updatedExtension.tags.includes(dnrTag)) {
                    updatedExtension.tags.push(dnrTag);
                }
            }

            return updatedExtension;
        } catch (error) {
            logger.error(extension, 'Blocking webRequest migration failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }
}
