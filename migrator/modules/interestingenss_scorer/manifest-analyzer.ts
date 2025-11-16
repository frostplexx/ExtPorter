import { Extension } from '../../types/extension';
import { InterestingnessBreakdown, DANGEROUS_PERMISSIONS } from './scoring-config';

/**
 * Analyzes extension manifest for permissions and structure
 */
export function analyzeManifest(extension: Extension, scores: InterestingnessBreakdown): void {
    const manifest = extension.manifest;

    if (!manifest) return;

    // Check for background page/service worker
    if (manifest.background || manifest.service_worker) {
        scores.background_page = 1;
    }

    // Check for content scripts
    if (
        manifest.content_scripts &&
        Array.isArray(manifest.content_scripts) &&
        manifest.content_scripts.length > 0
    ) {
        scores.content_scripts = 1;
    }

    // Count dangerous permissions
    const permissions = manifest.permissions || [];
    scores.dangerous_permissions = permissions.filter((perm: string) =>
        DANGEROUS_PERMISSIONS.has(perm)
    ).length;

    // Count host permissions
    let hostPermissionCount = 0;

    // Manifest v2 host permissions (in permissions array)
    for (const perm of permissions) {
        if (typeof perm === 'string' && (perm.includes('://') || perm.startsWith('*'))) {
            hostPermissionCount++;
        }
    }

    // Manifest v3 host permissions
    const hostPermissions = manifest.host_permissions || [];
    hostPermissionCount += hostPermissions.length;

    scores.host_permissions = hostPermissionCount;
}
