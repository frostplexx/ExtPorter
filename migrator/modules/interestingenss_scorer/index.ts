import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { WEIGHTS, InterestingnessBreakdown } from './scoring-config';
import { analyzeFiles, } from './file-analyzer';
import { analyzeManifest } from './manifest-analyzer';
import { calculateExtensionSize } from './size-calculator';
import { analyzeMigrationChanges } from './migration-analyzer';
import { FeatureTagger } from './feature-tagger';

/**
 * Migration module for calculating interestingness scores for extensions
 */
export class InterestingnessScorer implements MigrationModule {
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            const score = InterestingnessScorer.calculateInterestingnessScore(extension);

            // Add score to extension
            (extension as any).interestingness_score = score.total;
            (extension as any).interestingness_breakdown = score.breakdown;

            logger.debug(extension, `Calculated interestingness score: ${score.total}`, {
                breakdown: score.breakdown,
            });

            // Add feature/characteristic tags based on analysis
            await FeatureTagger.addFeatureTags(extension, score.breakdown);


            // NOTE: Do NOT call releaseMemory() or close() here!
            // Files are written asynchronously by WriteQueue and closed by Writer.writeFiles()

            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to calculate interestingness score', {
                error,
            });
            return new MigrationError(extension, error);
        }
    }

    private static calculateInterestingnessScore(extension: Extension): {
        total: number;
        breakdown: InterestingnessBreakdown;
    } {
        const scores: InterestingnessBreakdown = {
            webRequest: 0,
            html_lines: 0,
            storage_local: 0,
            background_page: 0,
            content_scripts: 0,
            dangerous_permissions: 0,
            host_permissions: 0,
            crypto_patterns: 0,
            network_requests: 0,
            extension_size: 0,
            api_renames: 0,
            manifest_changes: 0,
            file_modifications: 0,
            webRequest_to_dnr_migrations: 0,
        };

        // Analyze extension files for patterns
        analyzeFiles(extension, scores);

        // Analyze manifest for permissions and structure
        analyzeManifest(extension, scores);

        // Calculate extension size
        calculateExtensionSize(extension, scores);

        // Analyze migration-specific changes (if available)
        analyzeMigrationChanges(extension, scores);

        // Check if a webRequest to DNR migration was performed during this run
        if ((extension as any).metrics?.webRequest_to_dnr_migrations) {
            scores.webRequest_to_dnr_migrations = 1;
        }

        const total = Object.entries(scores).reduce((sum, [key, value]) => {
            return sum + value * WEIGHTS[key as keyof typeof WEIGHTS];
        }, 0);

        return { total: Math.round(total), breakdown: scores };
    }
}
