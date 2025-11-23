import * as cheerio from 'cheerio';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { logger } from './logger';

//TODO: move
/**
 * Extracted CWS data structure
 */
export interface CWSData {
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
export function parseCWSData(path_to_html: string): CWSData | null {
    try {
        // Check if file exists
        if (!existsSync(path_to_html)) {
            return null;
        }

        // Load HTML file
        const html = readFileSync(path_to_html, 'utf-8');

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
        logger.error(null, `Error parsing CWD HTML: ${error}`);
        return null;
    }
}

/**
 * Attempts to find and parse CWS HTML file from the CWS directory
 * @param extensionDir The extension directory path
 * @returns CWSInfo object if found and parsed, null otherwise
 */
export function findAndParseCWSInfo(extensionDir: string): CWSData | null {
    // Get the extension folder name (which should match the HTML filename)
    const extensionFolderName = path.basename(extensionDir);

    // Check if CWS_DIR environment variable is set
    const cwsDir = process.env.CWS_DIR;

    if (!cwsDir) {
        logger.debug(
            null,
            'CWS_DIR environment variable not set, skipping CWS metadata extraction'
        );
        return null;
    }

    if (!existsSync(cwsDir)) {
        logger.warn(null, `CWS_DIR does not exist: ${cwsDir}`);
        return null;
    }

    // Look for HTML file named after the extension folder in the CWS directory
    const cwsHtmlPath = path.join(cwsDir, `${extensionFolderName}.html`);

    if (existsSync(cwsHtmlPath)) {
        logger.debug(null, `Found CWS HTML file: ${cwsHtmlPath}`);
        return parseCWSData(cwsHtmlPath);
    }

    logger.debug(null, `No CWS HTML file found for extension: ${extensionFolderName}`, {
        expected_path: cwsHtmlPath,
        cws_dir: cwsDir,
    });
    return null;
}
