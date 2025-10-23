/**
 * Example usage of displayCWSData function
 *
 * This demonstrates how to display CWS HTML data with images using kitty graphics protocol
 */

import { displayCWSData, parseCWSData } from './info';

async function main() {
    const htmlPath = './path/to/your/cws.html';

    // Option 1: Display full CWS data with images
    console.log('=== Displaying full CWS data with images ===\n');
    await displayCWSData(htmlPath, {
        showLogo: true,
        showScreenshots: true,
        maxScreenshots: 3,
        imageWidth: 80,
        imageHeight: 20,
    });

    // Option 2: Get just the data without displaying
    console.log('\n=== Extracting data only ===\n');
    const data = parseCWSData(htmlPath);
    if (data) {
        console.log('Description length:', data.description.length);
        console.log('Logo URL:', data.images.logo);
        console.log('Screenshot count:', data.images.screenshots.length);
        console.log('Video count:', data.images.videoEmbeds.length);
    }
}

// Run the example
main().catch(console.error);
