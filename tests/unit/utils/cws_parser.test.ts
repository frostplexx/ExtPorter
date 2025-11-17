import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { parseCWSHtml, findAndParseCWSInfo } from '../../../migrator/utils/cws_parser';

describe('CWS Parser', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'cws_parser_test');

    beforeEach(() => {
        fs.ensureDirSync(testDir);
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
    });

    describe('parseCWSHtml', () => {
        it('should return null for non-existent file', () => {
            const nonExistentPath = path.join(testDir, 'non-existent.html');
            const result = parseCWSHtml(nonExistentPath);
            expect(result).toBeNull();
        });

        it('should extract description from meta tag', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="This is a test extension description">
                </head>
                <body></body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.description).toBe('This is a test extension description');
        });

        it('should extract rating information', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Test extension">
                </head>
                <body>
                    <div class="rsw-stars" title="4.5"></div>
                    <div class="q-N-O-k">1,234 ratings</div>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.rating).toBe(4.5);
            expect(result?.rating_count).toBe(1234);
        });

        it('should extract developer information', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Test extension">
                </head>
                <body>
                    <div class="e-f-Me">Test Developer</div>
                    <div class="e-f-y"><a href="https://example.com">Website</a></div>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.developer).toBe('Test Developer');
            expect(result?.developer_website).toBe('https://example.com');
        });

        it('should return null for HTML with no CWS data', () => {
            const htmlPath = path.join(testDir, 'empty.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head><title>Empty</title></head>
                <body><p>Nothing here</p></body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).toBeNull();
        });
    });

    describe('findAndParseCWSInfo', () => {
        it('should find and parse store.html if it exists', () => {
            const extensionDir = path.join(testDir, 'extension');
            fs.ensureDirSync(extensionDir);

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Extension from store.html">
                </head>
                <body></body>
                </html>
            `;
            fs.writeFileSync(path.join(extensionDir, 'store.html'), htmlContent);

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).not.toBeNull();
            expect(result?.description).toBe('Extension from store.html');
        });

        it('should try multiple filename patterns', () => {
            const extensionDir = path.join(testDir, 'extension');
            fs.ensureDirSync(extensionDir);

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Extension from cws.html">
                </head>
                <body></body>
                </html>
            `;
            fs.writeFileSync(path.join(extensionDir, 'cws.html'), htmlContent);

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).not.toBeNull();
            expect(result?.description).toBe('Extension from cws.html');
        });

        it('should return null if no CWS HTML file found', () => {
            const extensionDir = path.join(testDir, 'extension');
            fs.ensureDirSync(extensionDir);

            // Create some extension files but no CWS HTML
            fs.writeFileSync(path.join(extensionDir, 'popup.html'), '<html><body>Popup</body></html>');
            fs.writeFileSync(path.join(extensionDir, 'content.js'), 'console.log("test");');

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).toBeNull();
        });

        it('should detect large HTML files that might be CWS metadata', () => {
            const extensionDir = path.join(testDir, 'extension');
            fs.ensureDirSync(extensionDir);

            // Create a large HTML file with CWS data
            const largeHtmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Large HTML file with CWS data">
                </head>
                <body>
                    ${'<p>Padding content to make file larger</p>'.repeat(500)}
                </body>
                </html>
            `;
            fs.writeFileSync(path.join(extensionDir, 'metadata.html'), largeHtmlContent);

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).not.toBeNull();
            expect(result?.description).toBe('Large HTML file with CWS data');
        });
    });
});
