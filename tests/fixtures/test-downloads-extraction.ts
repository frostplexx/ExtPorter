/**
 * Demo script to show user count extraction from CWS HTML files
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCWSData } from '../../migrator/utils/cws_parser';

const cwsDir = '/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/dataset/cws';

console.log('Testing user count extraction from CWS HTML files\n');
console.log('='.repeat(60));

// Test specific theme files that have the category link issue
const themeFiles = [
    'aaehophfmcbenkglffhfbbnpdoipcbpa.html',
    'aabnbnjfdhemfkmomhchjigonhalpkdb.html',
    'aaelmbcanokcginpiogeoimabadaajfk.html',
];

console.log('\n--- Testing Themes (with category links) ---\n');
for (const file of themeFiles) {
    const htmlPath = path.join(cwsDir, file);
    if (fs.existsSync(htmlPath)) {
        const result = parseCWSData(htmlPath);

        if (result) {
            console.log(`File: ${file}`);
            console.log(`User Count: "${result.details.userCount || 'Not found'}"`);
            console.log(`Rating: ${result.details.rating || 'N/A'}`);
            console.log('-'.repeat(60));
        }
    }
}

// Get a few sample extension files
const files = fs
    .readdirSync(cwsDir)
    .filter((f) => f.endsWith('.html'))
    .slice(0, 5);

console.log('\n--- Testing Regular Extensions ---\n');
for (const file of files) {
    const htmlPath = path.join(cwsDir, file);
    const result = parseCWSData(htmlPath);

    if (result) {
        console.log(`File: ${file}`);
        console.log(`User Count: "${result.details.userCount || 'Not found'}"`);
        console.log(`Rating: ${result.details.rating || 'N/A'}`);
        console.log('-'.repeat(60));
    }
}

console.log('\n✓ Extraction complete!');
