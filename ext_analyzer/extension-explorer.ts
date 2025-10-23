import { Database, Collections } from '../migrator/features/database/db_manager';
import { ExtensionSearchResult, SearchOptions } from './types';
import { displayExtensionList, filterExtensions } from './display-utils';
import { getKeypress, showActionsMenu } from './input-handler';
import * as actions from './extension-actions';
import { Extension } from '../migrator/types/extension';
import { showInfo } from './info';

export class ExtensionExplorer {
    private lastSearchQuery: string = '';
    private lastSelectedIndex: number = 0;

    constructor() {}

    async getAllExtensions(options: SearchOptions = {}): Promise<ExtensionSearchResult[]> {
        if (!Database.shared.database) throw new Error('Database not initialized');

        const query: any = {};

        // Apply filters
        if (options.minScore !== undefined) {
            query.interestingness_score = { $gte: options.minScore };
        }

        if (options.hasMv3) {
            query.mv3_extension_id = { $exists: true, $ne: null };
        }

        if (options.noMv3) {
            query.$or = [{ mv3_extension_id: { $exists: false } }, { mv3_extension_id: null }];
        }

        if (options.permission) {
            query['manifest.permissions'] = { $in: [options.permission] };
        }

        if (options.nameFilter) {
            query.$or = [
                { name: { $regex: options.nameFilter, $options: 'i' } },
                { 'manifest.name': { $regex: options.nameFilter, $options: 'i' } },
                { 'manifest.description': { $regex: options.nameFilter, $options: 'i' } },
            ];
        }

        const allExtensions = await Database.shared.database
            .collection(Collections.EXTENSIONS)
            .find(query)
            .toArray();

        // return allExtensions.map((ext) => ({
        //     id: ext.id,
        //     name: ext.name || ext.manifest?.name || 'Unknown',
        //     manifest_v2_path: ext.manifest_v2_path || '',
        //     manifest: ext.manifest || {},
        //     files: ext.files || [],
        //     isNewTabExtension: ext.isNewTabExtension,
        //     mv3_extension_id: ext.mv3_extension_id,
        //     manifest_v3_path: ext.manifest_v3_path,
        //     interestingness_score: ext.interestingness_score || 0,
        //     interestingness_breakdown: ext.interestingness_breakdown,
        // }));
        return allExtensions as any as Extension[];
    }

    async searchExtensions(
        extensions: ExtensionSearchResult[]
    ): Promise<ExtensionSearchResult | null> {
        const sortedExtensions = extensions.sort(
            (a, b) => (b.interestingness_score || 0) - (a.interestingness_score || 0)
        );

        let searchQuery = this.lastSearchQuery;
        let filteredExtensions = filterExtensions(sortedExtensions, searchQuery);
        let selectedIndex = Math.min(this.lastSelectedIndex, filteredExtensions.length - 1);

        while (true) {
            displayExtensionList(
                searchQuery,
                filteredExtensions,
                sortedExtensions.length,
                selectedIndex
            );

            const key = await getKeypress();
            if (!key) continue;

            if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
                return null;
            } else if (key.name === 'return' && filteredExtensions.length > 0) {
                this.lastSearchQuery = searchQuery;
                this.lastSelectedIndex = selectedIndex;
                return filteredExtensions[selectedIndex];
            } else if (key.name === 'down') {
                selectedIndex = Math.min(filteredExtensions.length - 1, selectedIndex + 1);
            } else if (key.name === 'up') {
                selectedIndex = Math.max(0, selectedIndex - 1);
            } else if (key.name === 'backspace' || key.name === 'delete') {
                searchQuery = searchQuery.slice(0, -1);
                filteredExtensions = filterExtensions(sortedExtensions, searchQuery);
                selectedIndex = Math.min(selectedIndex, Math.max(0, filteredExtensions.length - 1));
            } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
                searchQuery += key.sequence;
                filteredExtensions = filterExtensions(sortedExtensions, searchQuery);
                selectedIndex = 0;
            }
        }
    }

    async runActionLoop(ext: ExtensionSearchResult): Promise<boolean> {
        while (true) {
            const action = await showActionsMenu(ext);

            switch (action) {
                case 'v':
                    await actions.viewSource(ext);
                    break;
                case 'c':
                    await actions.compareExtensions(ext);
                    break;
                case 'r':
                    await actions.runExtension(ext);
                    break;
                case 'i':
                    await showInfo(ext);
                    break;
                case 'l':
                    await actions.showLogs(ext);
                    break;
                case 'g':
                    await actions.grepSource(ext);
                    break;
                case 'm':
                    await actions.viewManifest(ext);
                    break;
                case 'o':
                    await actions.openDirectory(ext);
                    break;
                case 'd':
                    await actions.generateDescription(ext);
                    break;
                case 's':
                    return true; // Signal to search again
                case 'q':
                    return false; // Signal to quit
                default:
                    console.log('❌ Invalid action');
                    await showInfo(ext);
            }
        }
    }

    close(): void {
        // No cleanup needed for inquirer
    }
}
