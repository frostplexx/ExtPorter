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

    const cws_path = `${ext.manifest_v2_path.replace("extensions", "cws")}.html`

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
            try { fs.unlinkSync(logoPath); } catch (e) {
                console.log(e as any)
            }

            // Move cursor back to left for next line
            term.moveTo(1, cursorPos.y);
        }
    } else {
        // No logo, just display name normally
        console.log(chalk.bold('Name: ') + chalk.cyan(ext.name || ext.manifest?.name || 'Unknown'));
    }
    console.log(chalk.bold('Version: ') + chalk.yellow(ext.manifest?.version || cwsData?.details.version || 'Unknown'));

    // Display last updated if available from CWS
    if (cwsData?.details.updated) {
        console.log(chalk.bold('Last Updated: ') + chalk.cyan(cwsData.details.updated));
    }

    // Display rating if available from CWS
    if (cwsData?.details.rating) {
        const ratingText = cwsData.details.ratingCount
            ? `${cwsData.details.rating}/5 (${cwsData.details.ratingCount} ratings)`
            : `${cwsData.details.rating}/5`;
        console.log(chalk.bold('Rating: ') + chalk.yellow('⭐ ' + ratingText));
    }

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
    console.log(chalk.blue(` Description: ${chalk.dim(ext.manifest?.description || "")}`));
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

    // Display size if available from CWS
    if (cwsData?.details.size) {
        console.log('');
        console.log(chalk.bold('Size: ') + chalk.magenta(cwsData.details.size));
    }

    // Display languages if available from CWS
    if (cwsData?.details.languages && cwsData.details.languages.length > 0) {
        console.log(chalk.bold('Languages: ') + chalk.dim(cwsData.details.languages.join(', ')));
    }

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
 * Download an image from a URL to a temporary file with retry logic
 * @param url - The image URL
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param timeout - Timeout in milliseconds (default: 15000)
 * @param attempt - Current attempt number (for internal use)
 * @returns Path to the downloaded file or null if failed
 */
async function downloadImage(
    url: string,
    maxRetries: number = 3,
    timeout: number = 15000,
    attempt: number = 1
): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            // Convert to high resolution URL
            const highResUrl = getHighResImageUrl(url, 1280);

            const protocol = highResUrl.startsWith('https') ? https : http;
            const tempDir = os.tmpdir();
            const ext = '.png'; // Use PNG to support more formats
            const tempFile = path.join(tempDir, `cws-image-${Date.now()}-${Math.random().toString(36).substring(2, 11)}${ext}`);

            const file = fs.createWriteStream(tempFile);
            let requestAborted = false;
            let timedOut = false;

            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                },
                timeout: timeout,
            };

            const request = protocol.get(highResUrl, options, (response) => {
                // Follow redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    if (response.headers.location) {
                        request.destroy();
                        file.close();
                        try { fs.unlinkSync(tempFile); } catch (e) {
                            console.log(e as any)
                        }
                        resolve(downloadImage(response.headers.location, maxRetries, timeout, attempt));
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    request.destroy();
                    file.close();
                    try { fs.unlinkSync(tempFile); } catch (e) {
                        console.log(e as any)
                    }

                    // Retry on server errors or rate limiting
                    if (attempt < maxRetries && (response.statusCode === 429 || (typeof response.statusCode === 'number' && response.statusCode >= 500))) {
                        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
                        setTimeout(() => {
                            resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                        }, delay);
                        return;
                    }

                    resolve(null);
                    return;
                }

                // Set timeout for download completion
                const downloadTimeout = setTimeout(() => {
                    if (!timedOut && !requestAborted) {
                        timedOut = true;
                        request.destroy();
                        file.close();
                        try { fs.unlinkSync(tempFile); } catch (e) {
                            console.log(e as any)
                        }

                        // Retry on timeout
                        if (attempt < maxRetries) {
                            resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                        } else {
                            resolve(null);
                        }
                    }
                }, timeout);

                response.pipe(file);

                file.on('finish', () => {
                    clearTimeout(downloadTimeout);
                    file.close();

                    if (requestAborted || timedOut) {
                        try { fs.unlinkSync(tempFile); } catch (e) {
                            console.log(e as any)
                        }
                        resolve(null);
                        return;
                    }

                    // Verify file has content
                    try {
                        const stats = fs.statSync(tempFile);
                        if (stats.size > 0) {
                            resolve(tempFile);
                        } else {
                            fs.unlinkSync(tempFile);

                            // Retry on empty file
                            if (attempt < maxRetries) {
                                resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                            } else {
                                resolve(null);
                            }
                        }
                    } catch (e) {
                        console.log(e as any)
                        resolve(null);
                    }
                });

                file.on('error', (err) => {

                    console.log(err as any)
                    clearTimeout(downloadTimeout);
                    requestAborted = true;
                    request.destroy();
                    try { fs.unlinkSync(tempFile); } catch (e) {
                        console.log(e as any)
                    }

                    // Retry on file write errors
                    if (attempt < maxRetries) {
                        resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                    } else {
                        resolve(null);
                    }
                });
            });

            request.on('error', (err) => {

                console.log(err as any)
                requestAborted = true;
                file.close();
                try { fs.unlinkSync(tempFile); } catch (e) {
                    console.log(e as any)
                }

                // Retry on network errors
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    setTimeout(() => {
                        resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                    }, delay);
                } else {
                    resolve(null);
                }
            });

            request.on('timeout', () => {
                if (!timedOut && !requestAborted) {
                    timedOut = true;
                    request.destroy();
                    file.close();
                    try { fs.unlinkSync(tempFile); } catch (e) {
                        console.log(e as any)
                    }

                    // Retry on timeout
                    if (attempt < maxRetries) {
                        resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                    } else {
                        resolve(null);
                    }
                }
            });
        } catch (error) {

            console.log(error as any)
            // Retry on unexpected errors
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                setTimeout(() => {
                    resolve(downloadImage(url, maxRetries, timeout, attempt + 1));
                }, delay);
            } else {
                resolve(null);
            }
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
            console.log(e as any)
        }
    } catch (error) {
        if (!options?.silent) {
            console.log(chalk.red(`✗ Error displaying image: ${error}`));
        }
    }
}

/**
 * Download multiple images with controlled concurrency
 * @param urls - Array of image URLs
 * @param concurrency - Maximum number of simultaneous downloads (default: 3)
 * @returns Array of downloaded file paths (null for failed downloads)
 */
async function downloadImagesInParallel(urls: string[], concurrency: number = 3): Promise<(string | null)[]> {
    const results: (string | null)[] = new Array(urls.length).fill(null);

    // Download in batches to avoid overwhelming the connection pool
    for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
            batch.map(url => downloadImage(url))
        );

        // Map results back to their original positions
        batchResults.forEach((result, batchIndex) => {
            const resultIndex = i + batchIndex;
            if (result.status === 'fulfilled') {
                results[resultIndex] = result.value;
            } else {
                results[resultIndex] = null;
            }
        });

        // Small delay between batches to avoid rate limiting
        if (i + concurrency < urls.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return results;
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
    details: {
        version?: string;
        updated?: string;
        size?: string;
        languages?: string[];
        userCount?: string;
        rating?: string;
        ratingCount?: string;
        website?: string;
        developer?: string;
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

        // Extract details section information
        const details: CWSData['details'] = {};

        // Version
        $('.ZbWJPd.ecmXy .N3EXSc').each((i, el) => {
            details.version = $(el).text().trim();
        });

        // Updated date - look for the "Updated" label and get the next div
        $('.ZbWJPd.uBIrad').each((i, el) => {
            const label = $(el).find('.nws2nb').text().trim();
            if (label === 'Updated') {
                // Get the sibling div that's not .nws2nb
                const dateDiv = $(el).find('div').not('.nws2nb').first();
                details.updated = dateDiv.text().trim();
            }
        });

        // Size
        $('.ZbWJPd.ZSMSLb').each((i, el) => {
            const label = $(el).find('.nws2nb').text().trim();
            if (label === 'Size') {
                const sizeDiv = $(el).find('div').not('.nws2nb').first();
                details.size = sizeDiv.text().trim();
            }
        });

        // Languages
        $('.ZbWJPd.FFG5Td').each((i, el) => {
            const label = $(el).find('.nws2nb').text().trim();
            if (label === 'Languages') {
                const languages: string[] = [];
                $(el).find('div').not('.nws2nb').find('div').each((j, langEl) => {
                    const lang = $(langEl).text().trim();
                    if (lang) languages.push(lang);
                });
                details.languages = languages;
            }
        });

        // Rating
        const ratingEl = $('.Vq0ZA');
        if (ratingEl.length > 0) {
            details.rating = ratingEl.text().trim();
        }

        // Rating count - extract from the text like "15 ratings"
        const ratingCountEl = $('.xJEoWe');
        if (ratingCountEl.length > 0) {
            const ratingText = ratingCountEl.text().trim();
            const match = ratingText.match(/(\d+)\s+rating/);
            if (match) {
                details.ratingCount = match[1];
            }
        }

        // Website
        const websiteEl = $('.cJI8ee .tkwLZc');
        if (websiteEl.length > 0) {
            details.website = websiteEl.text().trim();
        }

        // Developer - look for the Developer section
        $('.ZbWJPd.odyJv').each((i, el) => {
            const label = $(el).find('.nws2nb').text().trim();
            if (label === 'Developer') {
                const devLink = $(el).find('.Gztlsc');
                if (devLink.length > 0) {
                    details.developer = devLink.attr('href') || devLink.text().trim();
                }
            }
        });

        return {
            description,
            images: {
                logo,
                ...images,
            },
            details,
        };

    } catch (error) {
        console.error(chalk.red(`Error parsing CWS HTML: ${error}`));
        return null;
    }
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
        imageHeight = 15,
    } = options || {};

    const { description, images } = data;

    // Display description
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
            try { fs.unlinkSync(logoPath); } catch (e) {
                console.log(e as any)
            }
        } else {
            console.log(chalk.yellow('⚠ Failed to download logo'));
        }
        console.log('');
    }

    // Display screenshots in rows of 2
    if (showScreenshots && images.screenshots.length > 0) {
        console.log(chalk.blue.bold(`Screenshots (${images.screenshots.length} total):`));
        const screenshotsToShow = images.screenshots.slice(0, maxScreenshots);

        // Download all screenshots
        const downloadedPaths = await downloadImagesInParallel(screenshotsToShow);

        // Count successful downloads and only show message on failure
        const successCount = downloadedPaths.filter(p => p !== null).length;
        const failCount = downloadedPaths.length - successCount;

        if (failCount > 0) {
            console.log(chalk.yellow(`⚠ Downloaded ${successCount}/${downloadedPaths.length} screenshots (${failCount} failed)`));
        }

        // Only proceed if we have at least one successful download
        if (successCount > 0) {
            // Check terminal width to decide layout
            const terminalWidth = term.width || process.stdout.columns || 80;
            const minWidthForSideBySide = 140; // Minimum width needed for 2 images side by side

            if (terminalWidth >= minWidthForSideBySide) {
                // Display in rows of 2 if terminal is wide enough
                const imagesPerRow = 2;

                for (let i = 0; i < downloadedPaths.length; i += imagesPerRow) {
                    const rowPaths = downloadedPaths.slice(i, i + imagesPerRow);
                    // Filter out nulls before displaying
                    if (rowPaths.some(p => p !== null)) {
                        await displayImagesInRow(rowPaths, { height: imageHeight });
                    }
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
                    try { fs.unlinkSync(path); } catch (e) {
                        console.log(e as any)
                    }
                }
            }
        } else {
            console.log(chalk.red('✗ Failed to download any screenshots'));
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
