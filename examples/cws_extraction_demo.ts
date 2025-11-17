/**
 * Example script demonstrating Chrome Web Store metadata extraction
 * 
 * This script shows how CWS information is automatically extracted when
 * extensions are loaded using find_extensions().
 * 
 * To run this example:
 * 1. Create a test extension directory with manifest.json
 * 2. Add a store.html file with CWS metadata
 * 3. Run: npx ts-node examples/cws_extraction_demo.ts
 */

import { find_extensions } from '../migrator/utils/find_extensions';
import { parseCWSHtml, findAndParseCWSInfo } from '../migrator/utils/cws_parser';
import * as fs from 'fs-extra';
import * as path from 'path';

// Example: Parse a single HTML file
function exampleParseSingleHtml() {
    console.log('\n=== Example 1: Parse CWS HTML File ===\n');
    
    const testDir = '/tmp/example-extension';
    fs.ensureDirSync(testDir);
    
    // Create a sample CWS HTML file
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="description" content="A powerful ad blocker for Chrome">
        </head>
        <body>
            <div class="rsw-stars" title="4.8"></div>
            <div class="q-N-O-k">250,000 ratings</div>
            <div class="e-f-ih">5,000,000+ users</div>
            <div class="h-C-b-p-D-md">Updated: November 15, 2024</div>
            <div class="e-f-Me">AdBlock Team</div>
        </body>
        </html>
    `;
    
    const htmlPath = path.join(testDir, 'store.html');
    fs.writeFileSync(htmlPath, htmlContent);
    
    const cwsInfo = parseCWSHtml(htmlPath);
    
    console.log('Extracted CWS Info:');
    console.log(JSON.stringify(cwsInfo, null, 2));
    
    // Cleanup
    fs.removeSync(testDir);
}

// Example: Load extension with CWS info
function exampleLoadExtension() {
    console.log('\n=== Example 2: Load Extension with CWS Info ===\n');
    
    const testDir = '/tmp/example-extension-2';
    fs.ensureDirSync(testDir);
    
    // Create manifest.json
    const manifest = {
        name: 'Example Extension',
        version: '1.0.0',
        manifest_version: 2,
        description: 'An example extension'
    };
    
    fs.writeJsonSync(path.join(testDir, 'manifest.json'), manifest);
    
    // Create CWS HTML
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="description" content="Example extension from Chrome Web Store">
        </head>
        <body>
            <div class="rsw-stars" title="4.5"></div>
            <div class="q-N-O-k">10,000 ratings</div>
            <div class="e-f-Me">Example Developer</div>
            <div class="e-f-y"><a href="https://example.com">Website</a></div>
        </body>
        </html>
    `;
    
    fs.writeFileSync(path.join(testDir, 'store.html'), htmlContent);
    
    // Load extension using find_extensions
    const extensions = find_extensions(testDir);
    
    if (extensions.length > 0) {
        const ext = extensions[0];
        console.log(`Extension Name: ${ext.name}`);
        console.log(`Extension ID: ${ext.id}`);
        console.log('\nCWS Info:');
        console.log(JSON.stringify(ext.cws_info, null, 2));
    }
    
    // Cleanup
    fs.removeSync(testDir);
}

// Example: Try different HTML filenames
function exampleDifferentFilenames() {
    console.log('\n=== Example 3: Different HTML Filenames ===\n');
    
    const testDir = '/tmp/example-extension-3';
    fs.ensureDirSync(testDir);
    
    // Create manifest.json
    fs.writeJsonSync(path.join(testDir, 'manifest.json'), {
        name: 'Test Extension',
        version: '1.0',
        manifest_version: 2
    });
    
    // Test with cws.html instead of store.html
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="description" content="Found with cws.html filename">
        </head>
        <body>
            <div class="e-f-Me">Developer Name</div>
        </body>
        </html>
    `;
    
    fs.writeFileSync(path.join(testDir, 'cws.html'), htmlContent);
    
    const cwsInfo = findAndParseCWSInfo(testDir);
    
    console.log('CWS Info found with cws.html:');
    console.log(JSON.stringify(cwsInfo, null, 2));
    
    // Cleanup
    fs.removeSync(testDir);
}

// Run examples
if (require.main === module) {
    console.log('===========================================');
    console.log('Chrome Web Store Metadata Extraction Demo');
    console.log('===========================================');
    
    try {
        exampleParseSingleHtml();
        exampleLoadExtension();
        exampleDifferentFilenames();
        
        console.log('\n===========================================');
        console.log('Demo completed successfully!');
        console.log('===========================================\n');
    } catch (error) {
        console.error('Error running demo:', error);
        process.exit(1);
    }
}
