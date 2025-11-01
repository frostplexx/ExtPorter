/**
 * Standalone demo of fakeium integration
 * Run with: ts-node tests/fakeium/demo.ts
 */

import { Fakeium } from 'fakeium';
import { setupMV2Mocks, setupMV3Mocks } from './chrome-api-mocks';

async function demonstrateFakeium() {
    console.log('=== Fakeium Integration Demo ===\n');

    // Demo 1: Simple MV2 extension code
    console.log('1. Running MV2 extension code...');
    const mv2Code = `
        // Simulate a simple MV2 extension background script
        chrome.extension.sendMessage({ type: 'hello' });
        chrome.browserAction.setBadgeText({ text: '5' });
        chrome.storage.sync.set({ count: 5 });
    `;

    const fakeiumMV2 = new Fakeium({
        sourceType: 'script',
        origin: 'chrome-extension://mock-mv2-extension'
    });

    setupMV2Mocks(fakeiumMV2);

    try {
        await fakeiumMV2.run('background-mv2.js', mv2Code);
        const mv2Events = fakeiumMV2.getReport().getAll();
        const mv2ApiCalls = mv2Events.filter((e: any) => e.path?.startsWith('chrome.'));

        console.log(`   ✓ Captured ${mv2ApiCalls.length} Chrome API calls`);
        console.log('   API calls:');
        mv2ApiCalls.forEach((call: any) => {
            console.log(`     - ${call.path} (${call.type})`);
        });
    } catch (error) {
        console.error('   ✗ Error:', error);
    }

    console.log('');

    // Demo 2: Equivalent MV3 code
    console.log('2. Running MV3 extension code...');
    const mv3Code = `
        // Same functionality in MV3
        chrome.runtime.sendMessage({ type: 'hello' });
        chrome.action.setBadgeText({ text: '5' });
        chrome.storage.sync.set({ count: 5 });
    `;

    const fakeiumMV3 = new Fakeium({
        sourceType: 'script',
        origin: 'chrome-extension://mock-mv3-extension'
    });

    setupMV3Mocks(fakeiumMV3);

    try {
        await fakeiumMV3.run('background-mv3.js', mv3Code);
        const mv3Events = fakeiumMV3.getReport().getAll();
        const mv3ApiCalls = mv3Events.filter((e: any) => e.path?.startsWith('chrome.'));

        console.log(`   ✓ Captured ${mv3ApiCalls.length} Chrome API calls`);
        console.log('   API calls:');
        mv3ApiCalls.forEach((call: any) => {
            console.log(`     - ${call.path} (${call.type})`);
        });
    } catch (error) {
        console.error('   ✗ Error:', error);
    }

    console.log('\n3. Comparison:');
    console.log('   MV2 uses: chrome.extension.*, chrome.browserAction.*');
    console.log('   MV3 uses: chrome.runtime.*, chrome.action.*');
    console.log('   Both use: chrome.storage.*');

    console.log('\n=== Demo Complete ===');
    console.log('\nTo use fakeium for migration validation:');
    console.log('1. yarn install (already done)');
    console.log('2. Use FakeiumRunner.runExtension() for full extensions');
    console.log('3. Use BehaviorComparator.compare() to validate migrations');
    console.log('4. See tests/fakeium/README.md for documentation');
}

// Run the demo
demonstrateFakeium().catch(console.error);
