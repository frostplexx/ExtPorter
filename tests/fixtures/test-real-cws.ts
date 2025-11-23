import { parseCWSData } from "../../migrator/utils/cws_parser";

const htmlPath = '/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/dataset/cws/aaagbdompnfgjaokopkpaceijcapjdde.html';

console.log('Testing with real CWS HTML file...\n');
const result = parseCWSData(htmlPath);

if (result) {
    console.log('✓ CWS parsing successful!\n');
    console.log(`Users: ${result.details.userCount}`);
    console.log(`Rating: ${result.details.rating}`);
    console.log(`Rating Count: ${result.details.ratingCount}`);
} else {
    console.log('✗ Failed to parse');
}
