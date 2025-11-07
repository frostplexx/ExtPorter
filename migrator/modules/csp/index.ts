import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { Tags } from '../../types/tags';
import { cspValidator, isCSPStringCompliant } from './csp-validator';
import { CSPTransformer, makeCSPStringCompliant } from './csp-transformer';


/**
 * Default CSP values for Manifest V3
 * See: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy#default_policy
 */
const DEFAULT_MV3_CSP = {
    extension_pages: "script-src 'self'; object-src 'self';",
    sandbox:
        "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';",
};

/**
 * Migration module for handling Content Security Policy (CSP) transformation
 * from Manifest V2 to Manifest V3 format
 */
export class MigrateCSP implements MigrationModule {
    static current_ext: Extension | null = null;

    /**
     * Migrates Content Security Policy from MV2 to MV3 format
     * @param extension The extension to migrate CSP for
     * @returns The extension with migrated CSP or a MigrationError
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        MigrateCSP.current_ext = extension;
        try {
            const csp = extension.manifest['content_security_policy'];

            // If no CSP exists, set the default
            if (!csp || typeof csp !== 'string') {
                extension.manifest['content_security_policy'] = DEFAULT_MV3_CSP;
                logger.info(extension, 'No CSP found, using default MV3 CSP');
                return extension;
            }

            // MV2 CSP is a string - check if it's compliant
            if (isCSPStringCompliant(csp)) {
                // Compliant - just convert to MV3 object format
                extension.manifest['content_security_policy'] = {
                    extension_pages: csp,
                    sandbox: DEFAULT_MV3_CSP.sandbox,
                };
                logger.info(extension, 'Transformed compliant MV2 CSP to MV3 format');
                return extension;

            } else { // Non-compliant - transform to make it compliant
                const compliantCSP = makeCSPStringCompliant(csp);
                extension.manifest['content_security_policy'] = {
                    extension_pages: compliantCSP,
                    sandbox: DEFAULT_MV3_CSP.sandbox,
                };
                logger.warn(
                    extension,
                    `Transformed non-compliant CSP from: "${csp}" to: "${compliantCSP}"`
                );

                // Add CSP_VALUE_MODIFIED tag to extension object
                if (!extension.tags) {
                    extension.tags = [];
                }
                const cspTag = Tags[Tags.CSP_VALUE_MODIFIED];
                if (!extension.tags.includes(cspTag)) {
                    extension.tags.push(cspTag);
                }

                return extension;
            }
        } catch (error) {
            logger.error(extension, 'Failed to migrate CSP', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }
}
