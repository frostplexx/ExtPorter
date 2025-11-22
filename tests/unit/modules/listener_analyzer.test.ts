import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ListenerAnalyzer } from '../../../migrator/modules/listener_analyzer';
import { logger } from '../../../migrator/utils/logger';
import { Extension, EventListener } from '../../../migrator/types/extension';
import { AbstractFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

// Mock dependencies
jest.mock('../../../migrator/utils/logger');

describe('ListenerAnalyzer', () => {
    let mockExtension: Extension;
    let mockBackgroundFile: jest.Mocked<AbstractFile>;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create a mock background file with event listeners
        const backgroundContent = `
// Test background script
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Installed');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log('Tab updated');
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log('Context menu clicked');
});
`;

        mockBackgroundFile = {
            path: 'background.js',
            filetype: ExtFileType.JS,
            getContent: jest.fn().mockReturnValue(backgroundContent),
            getBuffer: jest.fn().mockReturnValue(Buffer.from(backgroundContent)),
            getPath: jest.fn().mockReturnValue('background.js'),
            getSize: jest.fn().mockReturnValue(backgroundContent.length),
            getType: jest.fn().mockReturnValue('js' as any),
        } as any;

        mockExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {
                permissions: ['tabs'],
                background: { scripts: ['background.js'] },
            },
            files: [mockBackgroundFile as any],
        } as Extension;
    });

    describe('migrate', () => {
        it('should successfully extract event listeners from extension', async () => {
            const result = await ListenerAnalyzer.migrate(mockExtension);

            // Check it's not an error
            expect(result).not.toHaveProperty('error');

            const ext = result as Extension;
            expect(ext.event_listeners).toBeDefined();
            expect(ext.event_listeners).toBeInstanceOf(Array);
        });

        it('should extract all event listeners from background script', async () => {
            const result = await ListenerAnalyzer.migrate(mockExtension);
            const ext = result as Extension;

            expect(ext.event_listeners).toHaveLength(3);

            // Check that all listeners were found
            const apis = ext.event_listeners!.map((l: EventListener) => l.api);
            expect(apis).toContain('chrome.runtime.onInstalled');
            expect(apis).toContain('chrome.tabs.onUpdated');
            expect(apis).toContain('chrome.contextMenus.onClicked');
        });

        it('should include file path and line number in listener data', async () => {
            const result = await ListenerAnalyzer.migrate(mockExtension);
            const ext = result as Extension;

            const listener = ext.event_listeners!.find(
                (l: EventListener) => l.api === 'chrome.runtime.onInstalled'
            );

            expect(listener).toBeDefined();
            expect(listener!.file).toBe('background.js');
            expect(listener!.line).toBeDefined();
            expect(listener!.code_snippet).toBeDefined();
        });

        it('should handle extension with no event listeners', async () => {
            const noListenerFile = {
                path: 'content.js',
                filetype: ExtFileType.JS,
                getContent: jest.fn().mockReturnValue('console.log("no listeners");'),
                getBuffer: jest.fn().mockReturnValue(Buffer.from('console.log("no listeners");')),
                getPath: jest.fn().mockReturnValue('content.js'),
                getSize: jest.fn().mockReturnValue(100),
                getType: jest.fn().mockReturnValue('js' as any),
            } as any;

            mockExtension.files = [noListenerFile];

            const result = await ListenerAnalyzer.migrate(mockExtension);
            const ext = result as Extension;

            expect(ext.event_listeners).toBeDefined();
            expect(ext.event_listeners).toHaveLength(0);
        });

        it('should sort listeners by API name', async () => {
            const result = await ListenerAnalyzer.migrate(mockExtension);
            const ext = result as Extension;

            // Check that listeners are sorted alphabetically by API
            const apis = ext.event_listeners!.map((l: EventListener) => l.api);
            const sortedApis = [...apis].sort();

            expect(apis).toEqual(sortedApis);
        });

        it('should log debug information', async () => {
            await ListenerAnalyzer.migrate(mockExtension);

            expect(logger.debug).toHaveBeenCalledWith(
                mockExtension,
                'Starting listener extraction'
            );
        });
    });

    describe('name', () => {
        it('should have name "ListenerAnalyzer"', () => {
            expect(ListenerAnalyzer.name).toBe('ListenerAnalyzer');
        });
    });
});
