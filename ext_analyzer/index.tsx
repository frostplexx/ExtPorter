#!/usr/bin/env tsx
import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { MigratorTab } from './tabs/migrator-tab.js';
import { AnalyzerTab } from './tabs/analyzer-tab.js';
import { SettingsTab } from './tabs/settings-tab.js';
import { MenuBar } from './menu-bar.js';
import { WebSocketProvider } from './websocket-context.js';

type TabName = 'migrator' | 'analyzer' | 'settings';

interface Tab {
    name: TabName;
    label: string;
    component: React.FC;
}

const tabs: Tab[] = [
    { name: 'migrator', label: 'Migrator', component: MigratorTab },
    { name: 'analyzer', label: 'Extension Analyzer', component: AnalyzerTab },
    { name: 'settings', label: 'Settings', component: SettingsTab },
];

const App: React.FC = () => {
    const { exit } = useApp();
    const [activeTab, setActiveTab] = useState<TabName>('migrator');

    useInput((input, key) => {
        // Tab navigation with numbers 1, 2, 3
        if (input === '1') setActiveTab('migrator');
        if (input === '2') setActiveTab('analyzer');
        if (input === '3') setActiveTab('settings');

        // Tab navigation with arrow keys
        if (key.leftArrow || key.rightArrow) {
            const currentIndex = tabs.findIndex((t) => t.name === activeTab);
            if (key.leftArrow && currentIndex > 0) {
                setActiveTab(tabs[currentIndex - 1].name);
            } else if (key.rightArrow && currentIndex < tabs.length - 1) {
                setActiveTab(tabs[currentIndex + 1].name);
            }
        }

        // Global quit
        if (key.escape || (key.ctrl && input === 'c')) {
            exit();
            return;
        }
    });

    const ActiveComponent = tabs.find((t) => t.name === activeTab)?.component || MigratorTab;

    return (
        <WebSocketProvider>
            <Box
                flexDirection="column"
                width="100%"
                height="100%"
                overflowY="hidden"
                overflowX="hidden"
            >
                {/* Menu Bar */}
                <MenuBar activeTab={activeTab} tabs={tabs} />

                {/* Active Tab Content - Takes remaining space */}
                <Box width="100%" flexGrow={1} overflowY="hidden" overflowX="hidden">
                    <ActiveComponent />
                </Box>
            </Box>
        </WebSocketProvider>
    );
};

// Clear terminal before rendering
process.stdout.write('\x1Bc');

render(<App />);
