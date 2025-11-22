import { parseCWSHtml } from '../../migrator/utils/cws_parser';

const htmlPath = '/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/dataset/cws/aaagbdompnfgjaokopkpaceijcapjdde.html';

console.log('Testing with real CWS HTML file...\n');
const result = parseCWSHtml(htmlPath);

if (result) {
    console.log('✓ CWS parsing successful!\n');
    console.log(`Name: ${result.name}`);
    console.log(`Users: ${result.user_count}`);
    console.log(`Rating: ${result.rating}`);
    console.log(`Rating Count: ${result.rating_count}`);
} else {
    console.log('✗ Failed to parse');
}
