/**
 * CWS Data Display Module
 *
 * This module provides functionality to parse Chrome Web Store HTML pages and display
 * extension information including descriptions and images using the Kitty graphics protocol.
 *
 * Features:
 * - Extract full description from CWS HTML
 * - Extract logo, screenshots, and video URLs
 * - Display images in terminal using Kitty graphics protocol
 * - Download images from URLs automatically
 *
 * Usage:
 *   import { displayCWSData, parseCWSData } from './info';
 *
 *   // Display with images
 *   await displayCWSData('/path/to/cws.html', {
 *     showLogo: true,
 *     showScreenshots: true,
 *     maxScreenshots: 3
 *   });
 *
 *   // Get data only
 *   const data = parseCWSData('/path/to/cws.html');
 */

import chalk from 'chalk';
import { ExtensionSearchResult } from './types';
import { getMv3Path, getMv2Path } from './file-operations';
import { waitForKeypress } from './input-handler';
import * as fs from 'fs';
import * as cheerio from 'cheerio';
import * as terminalKit from 'terminal-kit';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';

export async function showInfo(ext: ExtensionSearchResult): Promise<void> {
    console.clear();

    // Clear all Kitty graphics images from previous displays
    term('\x1b_Ga=d\x1b\\');

    const cws_path = `${ext.manifest_v2_path.replace("extensions","cws")}.html`

    // Parse CWS data to get logo
    const cwsData = parseCWSData(cws_path);

    // Display logo next to name if available
    if (cwsData && cwsData.images.logo) {
        // Display name
        const nameText = chalk.bold('Name: ') + chalk.cyan(ext.name || ext.manifest?.name || 'Unknown');
        console.log(nameText);

        // Move cursor up and to the right to position logo
        const logoPath = await downloadImage(cwsData.images.logo);
        if (logoPath) {
            // Get cursor position using terminal-kit
            const cursorPos = await new Promise<{ x: number; y: number }>((resolve, reject) => {
                term.getCursorLocation((error: any, x?: number, y?: number) => {
                    if (error) reject(error);
                    else if (x !== undefined && y !== undefined) resolve({ x, y });
                    else reject(new Error('Failed to get cursor location'));
                });
            });

            // Position logo to the right of the name (around column 80)
            term.moveTo(80, cursorPos.y - 1);

            // Display small logo (5 rows)
            await displayImage(logoPath, { height: 5 });
            try { fs.unlinkSync(logoPath); } catch (e) {}

            // Move cursor back to left for next line
            term.moveTo(1, cursorPos.y);
        }
    } else {
        // No logo, just display name normally
        console.log(chalk.bold('Name: ') + chalk.cyan(ext.name || ext.manifest?.name || 'Unknown'));
    }
    console.log(chalk.bold('Version: ') + chalk.yellow(ext.manifest?.version || 'Unknown'));
    if (ext.interestingness_score !== undefined) {
        console.log(
            chalk.bold(`Interestingness Score: ${chalk.dim(ext.interestingness_score.toString())}`)
        );
    }
    console.log(chalk.bold('MV2 ID: ') + chalk.gray(ext.id));
    if (ext.mv3_extension_id) {
        console.log(chalk.bold('MV3 ID: ') + chalk.green(ext.mv3_extension_id));
    } else {
        console.log(chalk.bold('MV3 ID: ') + chalk.red('Not migrated'));
    }

    console.log('');
    console.log(chalk.blue(' Description: '));
    console.log(`Manifest: ${chalk.dim(ext.manifest?.description || 'No description')}`);
    // Display CWS data with images using kitty graphics protocol (no logo, already displayed)
    await displayCWSData(cws_path, {
        showLogo: false,
        showScreenshots: true,
        maxScreenshots: 4,  // 2 rows of 2 images
        imageWidth: 40,   // Maximum width per image
        imageHeight: 15,  // Maximum height per image
    });

    // Display tags
    if (ext.tags && ext.tags.length > 0) {
        console.log('');
        console.log(chalk.blue(' Tags:'));
        console.log(
            ext.tags
                .map((t) => {
                    return t.toLowerCase();
                })
                .join(chalk.dim(', '))
        );
    }

    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    console.log('');
    console.log(chalk.blue(' File Paths:'));
    if (mv2Path) console.log(chalk.dim('  MV2: ') + chalk.blue(mv2Path));
    if (mv3Path) console.log(chalk.dim('  MV3: ') + chalk.green(mv3Path));

    console.log('');
    await waitForKeypress(chalk.dim('Press Enter to continue...'));
}


const term = terminalKit.terminal;

/**
 * Convert Google image URL to high resolution version
 * @param url - The original image URL
 * @param size - Desired size (0 = original, or pixel width like 1280)
 * @returns Modified URL for higher resolution
 */
function getHighResImageUrl(url: string, size: number = 0): string {
    // For Googleusercontent images, modify the size parameter
    if (url.includes('googleusercontent.com')) {
        // Remove existing size parameters and add high-res one
        // Patterns like =s128, =w128, =h128, etc.
        url = url.replace(/=[swh]\d+/g, '');
        // Remove trailing parameters that might interfere
        url = url.replace(/-rj-sc0x[0-9a-f]+$/, '');
        // Add high resolution parameter
        return `${url}=s${size}`;
    }
    return url;
}

/**
 * Download an image from a URL to a temporary file
 * @param url - The image URL
 * @returns Path to the downloaded file or null if failed
 */
async function downloadImage(url: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            // Convert to high resolution URL
            const highResUrl = getHighResImageUrl(url, 1280);

            const protocol = highResUrl.startsWith('https') ? https : http;
            const tempDir = os.tmpdir();
            const ext = '.png'; // Use PNG to support more formats
            const tempFile = path.join(tempDir, `cws-image-${Date.now()}${ext}`);

            const file = fs.createWriteStream(tempFile);

            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                }
            };

            protocol.get(highResUrl, options, (response) => {
                // Follow redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    if (response.headers.location) {
                        file.close();
                        fs.unlinkSync(tempFile);
                        resolve(downloadImage(response.headers.location));
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    file.close();
                    try {
                        fs.unlinkSync(tempFile);
                    } catch (e) {}
                    resolve(null);
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    // Verify file has content
                    try {
                        const stats = fs.statSync(tempFile);
                        if (stats.size > 0) {
                            resolve(tempFile);
                        } else {
                            fs.unlinkSync(tempFile);
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });

                file.on('error', (err) => {
                    try {
                        fs.unlinkSync(tempFile);
                    } catch (e) {}
                    resolve(null);
                });
            }).on('error', (err) => {
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {}
                resolve(null);
            });
        } catch (error) {
            resolve(null);
        }
    });
}

/**
 * Display an image in the terminal using kitty graphics protocol
 * @param imagePath - Path to the image file (local path)
 * @param options - Optional display options (width, height)
 */
async function displayImage(imagePath: string, options?: { width?: number; height?: number }): Promise<void> {
    try {
        if (!fs.existsSync(imagePath)) {
            term.dim('Image not found\n');
            return;
        }

        // Read the image file
        const imageData = fs.readFileSync(imagePath);
        const base64Data = imageData.toString('base64');

        // Only specify height, let Kitty calculate width based on aspect ratio
        const rows = options?.height || 40;

        // Kitty graphics protocol escape sequence
        // a=T: transmit and display
        // f=100: PNG format (auto-detect)
        // t=d: direct data transmission
        // r=rows: height in terminal cells (width auto-calculated to preserve aspect ratio)
        const chunks = [];
        const chunkSize = 4096;

        for (let i = 0; i < base64Data.length; i += chunkSize) {
            const chunk = base64Data.slice(i, i + chunkSize);
            const isLast = i + chunkSize >= base64Data.length;
            const m = isLast ? 0 : 1; // m=1 means more data coming

            if (i === 0) {
                // First chunk includes control data - only specify rows
                chunks.push(`\x1b_Ga=T,f=100,t=d,r=${rows},m=${m};${chunk}\x1b\\`);
            } else {
                // Subsequent chunks only include data
                chunks.push(`\x1b_Gm=${m};${chunk}\x1b\\`);
            }
        }

        // Write all chunks to stdout
        for (const chunk of chunks) {
            term(chunk);
        }

        // Move cursor down using terminal-kit
        term.move(0, rows + 1);
    } catch (error) {
        term.dim(`Error displaying image: ${error}\n`);
    }
}

/**
 * Download and display an image from a URL using kitty graphics protocol
 * @param url - The image URL
 * @param options - Optional display options (width, height)
 * @param silent - Don't show downloading message
 */
async function displayImageFromUrl(url: string, options?: { width?: number; height?: number; silent?: boolean }): Promise<void> {
    try {
        const highResUrl = getHighResImageUrl(url, 1280);
        if (!options?.silent) {
            console.log(chalk.dim(`Downloading image (1280px): ${url.slice(0, 80)}...`));
        }
        const tempFile = await downloadImage(url);

        if (!tempFile) {
            if (!options?.silent) {
                console.log(chalk.yellow('⚠ Failed to download image'));
            }
            return;
        }

        await displayImage(tempFile, options);

        // Clean up temp file
        try {
            fs.unlinkSync(tempFile);
        } catch (e) {
            // Ignore cleanup errors
        }
    } catch (error) {
        if (!options?.silent) {
            console.log(chalk.red(`✗ Error displaying image: ${error}`));
        }
    }
}

/**
 * Download multiple images in parallel
 * @param urls - Array of image URLs
 * @returns Array of downloaded file paths (null for failed downloads)
 */
async function downloadImagesInParallel(urls: string[]): Promise<(string | null)[]> {
    return Promise.all(urls.map(url => downloadImage(url)));
}

/**
 * Display images side by side in a row using Kitty graphics protocol
 * @param imagePaths - Array of local image file paths
 * @param options - Display options
 */
async function displayImagesInRow(imagePaths: (string | null)[], options?: { width?: number; height?: number }): Promise<void> {
    // Filter out null paths
    const validPaths = imagePaths.filter((p): p is string => p !== null && fs.existsSync(p));
    if (validPaths.length === 0) return;

    // Maximum image width (height will be auto-calculated to preserve aspect ratio)
    const MAX_WIDTH = 35;

    // Fixed spacing between images (in columns) - closer together
    const spacing = 38;

    // Use the smaller of the specified width or MAX_WIDTH
    const imageWidth = Math.min(options?.width || MAX_WIDTH, MAX_WIDTH);

    // Get starting position using terminal-kit (promisified)
    const cursorLocation = await new Promise<{ x: number; y: number }>((resolve, reject) => {
        term.getCursorLocation((error: any, x?: number, y?: number) => {
            if (error) reject(error);
            else if (x !== undefined && y !== undefined) resolve({ x, y });
            else reject(new Error('Failed to get cursor location'));
        });
    });

    const startX = cursorLocation.x;
    const startY = cursorLocation.y;

    // Track maximum height for proper cursor positioning afterwards
    let maxHeight = 0;

    // Display each image at the current cursor position
    for (let i = 0; i < validPaths.length; i++) {
        // Position cursor for this image
        const xPos = startX + (i * spacing);
        term.moveTo(xPos, startY);

        const imagePath = validPaths[i];
        const imageData = fs.readFileSync(imagePath);
        const base64Data = imageData.toString('base64');

        // Transmit and display in one go (a=T)
        // Only specify width (c), height auto-calculated to preserve aspect ratio
        const chunks = [];
        const chunkSize = 4096;

        for (let j = 0; j < base64Data.length; j += chunkSize) {
            const chunk = base64Data.slice(j, j + chunkSize);
            const isLast = j + chunkSize >= base64Data.length;
            const m = isLast ? 0 : 1;

            if (j === 0) {
                // Transmit and display with C=1 to prevent cursor movement
                // Only specify width (c), let Kitty calculate height based on aspect ratio
                chunks.push(`\x1b_Ga=T,f=100,t=d,c=${imageWidth},C=1,m=${m};${chunk}\x1b\\`);
            } else {
                chunks.push(`\x1b_Gm=${m};${chunk}\x1b\\`);
            }
        }

        // Write all chunks using terminal-kit
        for (const chunk of chunks) {
            term(chunk);
        }

        // Estimate height based on typical aspect ratio (for cursor positioning)
        // Most screenshots are wider than tall, use balanced estimate
        const estimatedHeight = Math.floor(imageWidth / 3.0);
        maxHeight = Math.max(maxHeight, estimatedHeight);
    }

    // Move cursor down with slight padding
    term.moveTo(1, startY + maxHeight);
}

/**
 * Extracted CWS data structure
 */
interface CWSData {
    description: string;
    images: {
        logo?: string;
        screenshots: string[];
        videoThumbnails: string[];
        videoEmbeds: string[];
    };
}

/**
 * Parse Chrome Web Store HTML file and extract information
 * @param path_to_html - Path to the HTML file
 * @returns Extracted CWS data or null if parsing fails
 */
function parseCWSData(path_to_html: string): CWSData | null {
    try {
        // Check if file exists
        if (!fs.existsSync(path_to_html)) {
            return null;
        }

        // Load HTML file
        const html = fs.readFileSync(path_to_html, 'utf-8');

        // Load HTML into cheerio
        const $ = cheerio.load(html);

        // === EXTRACTION LOGIC ===

        // Extract the full long description from the Overview section
        // The description is in the div with class "JJ3H1e JpY6Fd" inside section with class "RNnO5Nb"
        let description = '';
        const overviewSection = $('.RNnO5e .JJ3H1e.JpY6Fd');
        if (overviewSection.length > 0) {
            // Get all paragraph text
            const paragraphs: string[] = [];
            overviewSection.find('p').each((i, el) => {
                const text = $(el).text().trim();
                if (text) {
                    paragraphs.push(text);
                }
            });
            description = paragraphs.join('\n\n');
        }

        // Fallback to meta description if no overview found
        if (!description) {
            description = $('meta[name="description"]').attr('content') || '';
        }

        // Extract images
        const images = {
            screenshots: [] as string[],
            videoThumbnails: [] as string[],
            videoEmbeds: [] as string[],
        };

        // Get logo from og:image meta tag or item logo
        const logo = $('meta[property="og:image"]').attr('content') ||
                    $('.rBxtY').attr('src') ||
                    undefined;

        // Get screenshots from media carousel
        // Screenshots are in elements with data-media-url attribute and data-is-video="false"
        $('.d9kNsf[data-is-video="false"]').each((i, el) => {
            const mediaUrl = $(el).attr('data-media-url');
            if (mediaUrl && !images.screenshots.includes(mediaUrl)) {
                images.screenshots.push(mediaUrl);
            }
        });

        // Get video thumbnails
        $('img[alt*="video thumbnail"], img.LAhvXe[srcset*="youtube"]').each((i, el) => {
            const srcset = $(el).attr('srcset');
            if (srcset && srcset.includes('youtube')) {
                const url = srcset.split(' ')[0]; // Get first URL from srcset
                if (!images.videoThumbnails.includes(url)) {
                    images.videoThumbnails.push(url);
                }
            }
        });

        // Get video embeds
        $('.d9kNsf[data-is-video="true"]').each((i, el) => {
            const mediaUrl = $(el).attr('data-media-url');
            if (mediaUrl && mediaUrl.includes('youtube') && !images.videoEmbeds.includes(mediaUrl)) {
                images.videoEmbeds.push(mediaUrl);
            }
        });

        return {
            description,
            images: {
                logo,
                ...images,
            },
        };

    } catch (error) {
        console.error(chalk.red(`Error parsing CWS HTML: ${error}`));
        return null;
    }
}

/**
 * Parse Chrome Web Store HTML file and format for display (without images)
 * @param path_to_html - Path to the HTML file
 * @returns Formatted string with extracted information
 */
function parseCWS(path_to_html: string): string {
    const data = parseCWSData(path_to_html);

    if (!data) {
        return chalk.dim('CWS: No HTML file found');
    }

    const { description, images } = data;

    // Format output
    let output = '';

    if (description) {
        const cleanDescription = description.trim();
        output += `CWS: ${chalk.dim(cleanDescription)}`;
    } else {
        output += chalk.dim('CWS: No description found');
    }

    // Add image count info
    const imageCount = images.screenshots.length + images.videoThumbnails.length;
    if (imageCount > 0) {
        output += chalk.dim(`\n     ${imageCount} media item(s) available`);
    }

    return output;
}

/**
 * Display CWS data with images using kitty graphics protocol
 * @param path_to_html - Path to the HTML file
 * @param options - Display options
 */
async function displayCWSData(
    path_to_html: string,
    options?: {
        showLogo?: boolean;
        showScreenshots?: boolean;
        maxScreenshots?: number;
        imageWidth?: number;
        imageHeight?: number;
    }
): Promise<void> {
    const data = parseCWSData(path_to_html);

    if (!data) {
        console.log(chalk.dim('CWS: No HTML file found'));
        return;
    }

    const {
        showLogo = true,
        showScreenshots = true,
        maxScreenshots = 4,
        imageWidth = 40,
        imageHeight = 15,
    } = options || {};

    const { description, images } = data;

    // Display description
    console.log('\n' + chalk.blue.bold('CWS Description:'));
    console.log(chalk.dim('─'.repeat(term.width || 80)));
    if (description) {
        console.log(description);
    } else {
        console.log(chalk.dim('No description found'));
    }
    console.log(chalk.dim('─'.repeat(term.width || 80)) + '\n');

    // Display logo
    if (showLogo && images.logo) {
        console.log(chalk.blue.bold('Logo:'));
        const logoPath = await downloadImage(images.logo);
        if (logoPath) {
            await displayImage(logoPath, { height: 10 });
            try { fs.unlinkSync(logoPath); } catch (e) {}
        }
        console.log('');
    }

    // Display screenshots in rows of 2
    if (showScreenshots && images.screenshots.length > 0) {
        console.log(chalk.blue.bold(`Screenshots (${images.screenshots.length} total):`));
        const screenshotsToShow = images.screenshots.slice(0, maxScreenshots);

        // Download all screenshots in parallel
        const downloadedPaths = await downloadImagesInParallel(screenshotsToShow);

        // Check terminal width to decide layout
        const terminalWidth = term.width || process.stdout.columns || 80;
        const minWidthForSideBySide = 140; // Minimum width needed for 2 images side by side

        if (terminalWidth >= minWidthForSideBySide) {
            // Display in rows of 2 if terminal is wide enough
            const imagesPerRow = 2;

            for (let i = 0; i < downloadedPaths.length; i += imagesPerRow) {
                const rowPaths = downloadedPaths.slice(i, i + imagesPerRow);
                await displayImagesInRow(rowPaths, { height: imageHeight });
            }
        } else {
            // Fall back to single column if terminal is too narrow
            for (const imgPath of downloadedPaths) {
                if (imgPath) {
                    await displayImage(imgPath, { height: imageHeight });
                }
            }
        }

        // Clean up downloaded files
        for (const path of downloadedPaths) {
            if (path) {
                try { fs.unlinkSync(path); } catch (e) {}
            }
        }

        if (images.screenshots.length > maxScreenshots) {
            console.log(chalk.dim(`... and ${images.screenshots.length - maxScreenshots} more screenshot(s)`));
        }

        // Add extra spacing to prevent text overlap
        console.log('\n\n');
    }

    // Display video info
    if (images.videoEmbeds.length > 0) {
        console.log(chalk.blue.bold('Videos:'));
        images.videoEmbeds.forEach((url, i) => {
            console.log(chalk.dim(`${i + 1}. ${url}`));
        });
        console.log('');
    }
}

// Export functions for use elsewhere
export {
    parseCWSData,
    CWSData,
    displayImage,
    displayImageFromUrl,
    displayCWSData,
    displayImagesInRow,
    downloadImagesInParallel
};
