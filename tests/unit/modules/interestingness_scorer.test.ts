import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { InterestingnessScorer } from '../../../migrator/modules/interestingness_scorer';
import { logger } from '../../../migrator/utils/logger';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';
import { AbstractFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

// Mock dependencies
jest.mock('../../../migrator/utils/logger');

describe('InterestingnessScorer', () => {
    let mockExtension: Extension;
    let mockFile: jest.Mocked<AbstractFile>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockFile = {
            path: 'test.js',
            filetype: ExtFileType.JS,
            getContent: jest.fn().mockReturnValue('console.log("test");'),
            getBuffer: jest.fn().mockReturnValue(Buffer.from('console.log("test");')),
            getPath: jest.fn().mockReturnValue('test.js'),
            getSize: jest.fn().mockReturnValue(100),
            getType: jest.fn().mockReturnValue('js' as any),
        } as any;

        mockExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {
                permissions: ['tabs'],
                content_scripts: [{ matches: ['*://*/*'] }],
                background: { service_worker: 'background.js' },
            },
            files: [mockFile as any],
        } as Extension;
    });

    describe('migrate', () => {
        it('should successfully calculate interestingness score and add it to extension', async () => {
            const result = await InterestingnessScorer.migrate(mockExtension);

            expect(result).toBe(mockExtension);
            expect((result as any).interestingness_score).toBeDefined();
            expect((result as any).interestingness_breakdown).toBeDefined();
            expect(logger.debug).toHaveBeenCalledWith(
                mockExtension,
                expect.stringContaining('Calculated interestingness score:'),
                expect.objectContaining({
                    breakdown: expect.any(Object),
                })
            );
        });

        it('should handle errors and return MigrationError', async () => {
            const error = new Error('Calculation failed');
            // Make extension.files throw an error when accessed to trigger outer error handler
            const brokenExtension = {
                ...mockExtension,
                get files(): any {
                    throw error;
                },
            };

            const result = await await InterestingnessScorer.migrate(brokenExtension);

            expect(result).toBeInstanceOf(MigrationError);
            expect((result as MigrationError).extension).toBe(brokenExtension);
            expect(logger.error).toHaveBeenCalledWith(
                brokenExtension,
                'Failed to calculate interestingness score',
                expect.objectContaining({
                    error,
                })
            );
        });

        it('should calculate higher scores for extensions with dangerous permissions', async () => {
            const extensionWithDangerousPerms = {
                ...mockExtension,
                manifest: {
                    permissions: ['tabs', 'cookies', 'history'],
                },
            };

            const result = await InterestingnessScorer.migrate(extensionWithDangerousPerms);
            const score1 = (result as any).interestingness_score;

            const extensionWithoutPerms = {
                ...mockExtension,
                manifest: {},
            };

            const result2 = await InterestingnessScorer.migrate(extensionWithoutPerms);
            const score2 = (result2 as any).interestingness_score;

            expect(score1).toBeGreaterThan(score2);
        });

        it('should calculate scores for extensions with webRequest patterns', async () => {
            mockFile.getContent.mockReturnValue('chrome.webRequest.onBeforeRequest.addListener();');

            const result = await InterestingnessScorer.migrate(mockExtension);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.webRequest).toBeGreaterThan(0);
        });

        it('should calculate scores for extensions with storage.local usage', async () => {
            mockFile.getContent.mockReturnValue('chrome.storage.local.get();');

            const result = await InterestingnessScorer.migrate(mockExtension);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.storage_local).toBeGreaterThan(0);
        });

        it('should calculate scores for HTML content', async () => {
            mockFile.filetype = ExtFileType.HTML;
            mockFile.getContent.mockReturnValue(
                '<html>\n<body>\n<div>Test</div>\n</body>\n</html>'
            );

            const result = await InterestingnessScorer.migrate(mockExtension);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.html_lines).toBeGreaterThan(0);
        });

        it('should detect crypto patterns', async () => {
            mockFile.getContent.mockReturnValue('eval("some code"); btoa("encoded");');

            const result = await InterestingnessScorer.migrate(mockExtension);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.crypto_patterns).toBeGreaterThan(0);
        });

        it('should detect network request patterns', async () => {
            mockFile.getContent.mockReturnValue(
                'fetch("http://example.com"); new XMLHttpRequest();'
            );

            const result = await InterestingnessScorer.migrate(mockExtension);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.network_requests).toBeGreaterThan(0);
        });

        it('should score background pages/service workers', async () => {
            const extensionWithBackground = {
                ...mockExtension,
                manifest: {
                    background: { service_worker: 'background.js' },
                },
            };

            const result = await InterestingnessScorer.migrate(extensionWithBackground);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.background_page).toBeGreaterThan(0);
        });

        it('should score content scripts', async () => {
            const extensionWithContentScripts = {
                ...mockExtension,
                manifest: {
                    content_scripts: [{ matches: ['*://*/*'] }],
                },
            };

            const result = await InterestingnessScorer.migrate(extensionWithContentScripts);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.content_scripts).toBeGreaterThan(0);
        });

        it('should calculate extension size contribution', async () => {
            // Create a large content to exceed 100KB threshold (score is per 100KB)
            const largeContent = 'x'.repeat(150 * 1024); // 150KB of content
            mockFile.getContent.mockReturnValue(largeContent);
            mockFile.getBuffer.mockReturnValue(Buffer.from(largeContent));

            const result = await InterestingnessScorer.migrate(mockExtension);
            const breakdown = (result as any).interestingness_breakdown;

            expect(breakdown.extension_size).toBeGreaterThan(0);
        });
    });
});
