import React from 'react';
import { Box, Text } from 'ink';
import { useWebSocket } from './websocket-context.js';

type TabName = 'migrator' | 'analyzer' | 'settings';

interface MenuBarProps {
    activeTab: TabName;
    tabs: Array<{ name: TabName; label: string }>;
}

export const MenuBar: React.FC<MenuBarProps> = ({ activeTab, tabs }) => {
    const { connectionStatus, databaseStatus } = useWebSocket();

    const getStatusIcon = (status: 'connected' | 'disconnected' | 'connecting'): string => {
        switch (status) {
            case 'connected':
                return '●'; // Filled circle
            case 'connecting':
                return '◐'; // Half circle
            case 'disconnected':
                return '○'; // Empty circle
        }
    };

    const getStatusColor = (status: 'connected' | 'disconnected' | 'connecting'): string => {
        switch (status) {
            case 'connected':
                return 'green';
            case 'connecting':
                return 'yellow';
            case 'disconnected':
                return 'red';
        }
    };

    const getStatusText = (status: 'connected' | 'disconnected' | 'connecting'): string => {
        switch (status) {
            case 'connected':
                return 'Connected';
            case 'connecting':
                return 'Connecting';
            case 'disconnected':
                return 'Disconnected';
        }
    };

    return (
        <Box flexDirection="column" width="100%">
            {/* Menu Bar */}
            <Box width="100%">
                {/* Left: App Title */}
                <Box marginRight={2}>
                    <Text bold color="cyan">
                        ExtPorter
                    </Text>
                </Box>

                {/* Spacer */}
                <Box flexGrow={1} />

                {/* Center: Tabs */}
                <Box>
                    {tabs.map((tab, index) => {
                        const isActive = tab.name === activeTab;
                        return (
                            <Box key={tab.name} marginRight={2}>
                                <Text
                                    bold={isActive}
                                    color={isActive ? 'cyan' : 'white'}
                                    backgroundColor={isActive ? 'blue' : undefined}
                                    dimColor={!isActive}
                                >
                                    {index + 1}. {tab.label}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>

                {/* Spacer */}
                <Box flexGrow={1} />

                {/* Right: Status Indicators */}
                <Box>
                    <Text dimColor>┃ Server: </Text>
                    <Text color={getStatusColor(connectionStatus)}>
                        {getStatusIcon(connectionStatus)} {getStatusText(connectionStatus)}
                    </Text>
                    <Text dimColor> ┃ Database: </Text>
                    <Text color={getStatusColor(databaseStatus)}>
                        {getStatusIcon(databaseStatus)} {getStatusText(databaseStatus)}
                    </Text>
                    <Text dimColor> ┃</Text>
                </Box>
            </Box>

            {/* Full-width Separator - Uses single line style which stretches to full width */}
            <Box width="100%" borderStyle="single" borderTop />
        </Box>
    );
};
