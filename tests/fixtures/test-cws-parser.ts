/**
 * Manual test script for CWS parser
 * Run with: npx ts-node tests/fixtures/test-cws-parser.ts
 */

import { parseCWSHtml } from '../../migrator/utils/cws_parser';
import path from 'path';

const htmlPath = path.join(__dirname, 'sample-cws.html');

console.log('Testing CWS Parser with realistic HTML...\n');
console.log(`HTML file: ${htmlPath}\n`);

const result = parseCWSHtml(htmlPath);

if (result) {
    console.log('✓ CWS parsing successful!\n');
    console.log('Extracted data:');
    console.log('===============\n');

    console.log(`Name: ${result.name}`);
    console.log(`\nShort Description (meta):\n${result.short_description}`);
    console.log(`\nFull Description (Overview):\n${result.description}`);

    if (result.images && result.images.length > 0) {
        console.log(`\nScreenshots (${result.images.length} found):`);
        result.images.forEach((url, idx) => {
            console.log(`  ${idx + 1}. ${url}`);
        });
    } else {
        console.log('\n✗ No images found');
    }

    if (result.rating) {
        console.log(`\nRating: ${result.rating} stars`);
    }
    if (result.rating_count) {
        console.log(`Rating Count: ${result.rating_count.toLocaleString()}`);
    }
    if (result.user_count) {
        console.log(`Users: ${result.user_count}`);
    }
    if (result.developer) {
        console.log(`Developer: ${result.developer}`);
    }
    if (result.developer_website) {
        console.log(`Website: ${result.developer_website}`);
    }

    console.log('\n✓ All data extracted successfully!');
} else {
    console.log('✗ Failed to parse CWS HTML');
    process.exit(1);
}
