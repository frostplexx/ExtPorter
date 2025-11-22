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

        it('should extract full description from Overview section', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Short meta description">
                </head>
                <body>
                    <section class="MHH2Z">
                        <div class="JJ3H1e JpY6Fd">
                            <p>This is the full detailed description from the Overview section. It contains much more information than the meta description.</p>
                        </div>
                    </section>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.description).toBe(
                'This is the full detailed description from the Overview section. It contains much more information than the meta description.'
            );
            expect(result?.short_description).toBe('Short meta description');
        });

        it('should fall back to meta description if Overview section not found', () => {
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
            expect(result?.short_description).toBe('This is a test extension description');
        });

        it('should extract images from modern CWS HTML structure', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Test extension">
                </head>
                <body>
                    <div data-media-url="https://lh3.googleusercontent.com/screenshot1.png" 
                         data-is-video="false" 
                         data-slide-index="1">
                        <img class="LAhvXe" src="data:image/gif;base64,R0lGODlhAQABAID" />
                    </div>
                    <div data-media-url="https://lh3.googleusercontent.com/screenshot2.png" 
                         data-is-video="false" 
                         data-slide-index="2">
                        <img class="LAhvXe" src="data:image/gif;base64,R0lGODlhAQABAID" />
                    </div>
                    <div data-media-url="https://lh3.googleusercontent.com/video.mp4" 
                         data-is-video="true" 
                         data-slide-index="3">
                    </div>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.images).toBeDefined();
            expect(result?.images?.length).toBe(2);
            expect(result?.images).toContain('https://lh3.googleusercontent.com/screenshot1.png');
            expect(result?.images).toContain('https://lh3.googleusercontent.com/screenshot2.png');
            // Verify video is not included
            expect(result?.images).not.toContain('https://lh3.googleusercontent.com/video.mp4');
        });

        it('should filter out placeholder images and duplicates', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Test extension">
                </head>
                <body>
                    <div data-media-url="https://lh3.googleusercontent.com/screenshot1.png" 
                         data-is-video="false">
                    </div>
                    <div data-media-url="https://lh3.googleusercontent.com/screenshot1.png" 
                         data-is-video="false">
                    </div>
                    <img src="data:image/gif;base64,R0lGODlhAQABAID" />
                    <img src="https://example.com/icon_128.png" />
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.images).toBeDefined();
            expect(result?.images?.length).toBe(1);
            expect(result?.images).toContain('https://lh3.googleusercontent.com/screenshot1.png');
            // Verify placeholder and icon images are filtered out
            expect(result?.images?.some((url) => url.includes('data:image'))).toBe(false);
            expect(result?.images?.some((url) => url.includes('icon'))).toBe(false);
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

        it('should extract user count from modern CWS format', () => {
            const htmlPath = path.join(testDir, 'store.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Test extension">
                </head>
                <body>
                    <div class="F9iKBc">2,000 users</div>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.user_count).toBe('2,000 users');
        });

        it('should extract user count from theme CWS format (with category link)', () => {
            const htmlPath = path.join(testDir, 'theme.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Test theme">
                </head>
                <body>
                    <div class="F9iKBc"><a>Theme</a>32 users</div>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).not.toBeNull();
            expect(result?.user_count).toBe('32 users');
        });

        it('should return null for HTML with no CWS data', () => {
            const htmlPath = path.join(testDir, 'empty.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head></head>
                <body><p>Nothing here</p></body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);
            expect(result).toBeNull();
        });
    });

    describe('findAndParseCWSInfo', () => {
        const originalCwsDir = process.env.CWS_DIR;

        afterEach(() => {
            // Restore original CWS_DIR
            if (originalCwsDir) {
                process.env.CWS_DIR = originalCwsDir;
            } else {
                delete process.env.CWS_DIR;
            }
        });

        it('should find and parse CWS HTML from CWS_DIR', () => {
            const cwsDir = path.join(testDir, 'cws_files');
            const extensionDir = path.join(testDir, 'my-extension');

            fs.ensureDirSync(cwsDir);
            fs.ensureDirSync(extensionDir);

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Extension from CWS directory">
                </head>
                <body></body>
                </html>
            `;
            // CWS HTML file is named after the extension directory name
            fs.writeFileSync(path.join(cwsDir, 'my-extension.html'), htmlContent);

            // Set CWS_DIR environment variable
            process.env.CWS_DIR = cwsDir;

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).not.toBeNull();
            expect(result?.short_description).toBe('Extension from CWS directory');
        });

        it('should return null if CWS_DIR not set', () => {
            const extensionDir = path.join(testDir, 'extension');
            fs.ensureDirSync(extensionDir);

            // Clear CWS_DIR
            delete process.env.CWS_DIR;

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).toBeNull();
        });

        it('should return null if CWS_DIR does not exist', () => {
            const extensionDir = path.join(testDir, 'extension');
            fs.ensureDirSync(extensionDir);

            // Set CWS_DIR to non-existent directory
            process.env.CWS_DIR = path.join(testDir, 'non-existent-cws-dir');

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).toBeNull();
        });

        it('should return null if no matching CWS HTML file found', () => {
            const cwsDir = path.join(testDir, 'cws_files');
            const extensionDir = path.join(testDir, 'my-extension');

            fs.ensureDirSync(cwsDir);
            fs.ensureDirSync(extensionDir);

            // Create a different HTML file, but not the one matching the extension name
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="description" content="Different extension">
                </head>
                </html>
            `;
            fs.writeFileSync(path.join(cwsDir, 'different-extension.html'), htmlContent);

            process.env.CWS_DIR = cwsDir;

            const result = findAndParseCWSInfo(extensionDir);
            expect(result).toBeNull();
        });

        it('should extract all data from realistic CWS HTML', () => {
            const htmlPath = path.join(testDir, 'realistic-cws.html');
            const htmlContent = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta property="og:title" content="Sample Extension - Chrome Web Store">
                    <meta name="description" content="This is a short meta description for search results">
                    <title>Sample Extension - Chrome Web Store</title>
                </head>
                <body>
                    <!-- Screenshot carousel with modern CWS structure -->
                    <div class="screenshot-carousel">
                        <div data-media-url="https://lh3.googleusercontent.com/screenshot1.png" 
                             data-is-video="false" 
                             data-slide-index="1">
                            <img class="LAhvXe" src="data:image/gif;base64,R0lGODlhAQABAID" />
                        </div>
                        <div data-media-url="https://lh3.googleusercontent.com/screenshot2.png" 
                             data-is-video="false" 
                             data-slide-index="2">
                            <img class="LAhvXe" src="data:image/gif;base64,R0lGODlhAQABAID" />
                        </div>
                        <div data-media-url="https://lh3.googleusercontent.com/screenshot3.png" 
                             data-is-video="false" 
                             data-slide-index="3">
                            <img class="LAhvXe" src="data:image/gif;base64,R0lGODlhAQABAID" />
                        </div>
                        <div data-media-url="https://lh3.googleusercontent.com/promo-video.mp4" 
                             data-is-video="true" 
                             data-slide-index="4">
                        </div>
                    </div>

                    <!-- Overview section with full description -->
                    <section class="MHH2Z">
                        <h2>Overview</h2>
                        <div class="JJ3H1e JpY6Fd">
                            <p>This is the complete and detailed description of the Sample Extension.</p>
                            <p>It provides comprehensive information about all the features and capabilities.</p>
                            <p>This description is much longer and more informative than the meta description.</p>
                        </div>
                    </section>

                    <!-- Extension metadata -->
                    <div class="metadata">
                        <div class="rsw-stars" title="4.7">★★★★★</div>
                        <div class="q-N-O-k">15,432 ratings</div>
                        <div class="e-f-ih">500,000+ users</div>
                        <div class="e-f-Me">Sample Developer Inc.</div>
                        <div class="e-f-y"><a href="https://developer.example.com">Website</a></div>
                    </div>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);

            const result = parseCWSHtml(htmlPath);

            expect(result).not.toBeNull();

            // Verify name extraction
            expect(result?.name).toBe('Sample Extension');

            // Verify description extraction - full description from Overview section
            expect(result?.description).toContain('complete and detailed description');
            expect(result?.description).toContain('comprehensive information');
            expect(result?.description).toContain('much longer and more informative');

            // Verify short description from meta tag
            expect(result?.short_description).toBe(
                'This is a short meta description for search results'
            );

            // Verify image extraction - 3 screenshots, no video
            expect(result?.images).toBeDefined();
            expect(result?.images?.length).toBe(3);
            expect(result?.images).toContain('https://lh3.googleusercontent.com/screenshot1.png');
            expect(result?.images).toContain('https://lh3.googleusercontent.com/screenshot2.png');
            expect(result?.images).toContain('https://lh3.googleusercontent.com/screenshot3.png');
            expect(result?.images).not.toContain(
                'https://lh3.googleusercontent.com/promo-video.mp4'
            );

            // Verify metadata
            expect(result?.rating).toBe(4.7);
            expect(result?.rating_count).toBe(15432);
            expect(result?.user_count).toBe('500,000+ users');
            expect(result?.developer).toBe('Sample Developer Inc.');
            expect(result?.developer_website).toBe('https://developer.example.com');
        });
    });
});
