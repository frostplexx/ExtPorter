import * as cheerio from 'cheerio';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * Interface for Chrome Web Store information extracted from HTML
 */
export interface CWSInfo {
    name?: string;
    description?: string;
    short_description?: string;
    images?: string[];
    rating?: number;
    rating_count?: number;
    user_count?: string;
    last_updated?: string;
    version?: string;
    size?: string;
    languages?: string[];
    developer?: string;
    developer_address?: string;
    developer_website?: string;
    privacy_policy?: string;
}

/**
 * Parses Chrome Web Store HTML file to extract extension metadata
 * @param htmlPath Path to the CWS HTML file
 * @returns CWSInfo object with extracted metadata, or null if parsing fails
 */
export function parseCWSHtml(htmlPath: string): CWSInfo | null {
    try {
        if (!existsSync(htmlPath)) {
            logger.debug(null, `CWS HTML file not found: ${htmlPath}`);
            return null;
        }

        const htmlContent = readFileSync(htmlPath, 'utf-8');
        const $ = cheerio.load(htmlContent);

        const cwsInfo: CWSInfo = {};

        // Extract name/title
        const name =
            $('meta[property="og:title"]').attr('content') ||
            $('h1').first().text() ||
            $('title').text() ||
            $('.e-f-w').text();
        if (name) {
            // Clean up the name by removing common CWS suffixes
            let cleanName = name.trim();
            cleanName = cleanName.replace(/\s*-\s*Chrome Web Store\s*$/i, '');
            cleanName = cleanName.replace(/\s*\|\s*Chrome Web Store\s*$/i, '');
            cwsInfo.name = cleanName.trim();
        }

        // Extract images
        const images: string[] = [];

        // Try various selectors for images
        // 1. Open Graph image (usually the icon)
        $('meta[property="og:image"]').each((_, elem) => {
            const imgUrl = $(elem).attr('content');
            if (imgUrl) images.push(imgUrl.trim());
        });

        // 2. Screenshot carousel images
        $('.F-N-i-W-j img').each((_, elem) => {
            const imgUrl = $(elem).attr('src');
            if (imgUrl) images.push(imgUrl.trim());
        });

        // 3. Screenshot section images
        $('.e-f-s-na-Xb img, .screenshot img').each((_, elem) => {
            const imgUrl = $(elem).attr('src');
            if (imgUrl) images.push(imgUrl.trim());
        });

        // 4. Additional selectors for modern Chrome Web Store
        $('img[src*="chrome.google.com/webstore"]').each((_, elem) => {
            const imgUrl = $(elem).attr('src');
            if (imgUrl && !imgUrl.includes('icon')) {
                images.push(imgUrl.trim());
            }
        });

        // 5. Look for images in common screenshot containers
        $('.webstore-screenshots img, [class*="screenshot"] img, [class*="Screenshot"] img').each(
            (_, elem) => {
                const imgUrl = $(elem).attr('src');
                if (imgUrl) images.push(imgUrl.trim());
            }
        );

        // Remove duplicates
        if (images.length > 0) {
            cwsInfo.images = [...new Set(images)];
            logger.debug(null, `Extracted ${cwsInfo.images.length} unique images from CWS HTML`);
        } else {
            logger.debug(null, 'No images found in CWS HTML');
        }

        // Extract description
        const description =
            $('meta[name="description"]').attr('content') ||
            $('.C-b-p-j-D').text() ||
            $('.e-f-b-L').text();
        if (description) {
            cwsInfo.description = description.trim();
        }

        // Extract short description (usually in meta tag or summary section)
        const shortDescription = $('.C-b-p-j-Oa').text() || $('.a-u-M').first().text();
        if (shortDescription) {
            cwsInfo.short_description = shortDescription.trim();
        }

        // Extract rating
        const ratingText =
            $('.rsw-stars').attr('title') ||
            $('[aria-label*="star"]').attr('aria-label') ||
            $('.q-N-nd').text();
        if (ratingText) {
            const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
            if (ratingMatch) {
                cwsInfo.rating = parseFloat(ratingMatch[1]);
            }
        }

        // Extract rating count
        const ratingCountText =
            $('.q-N-O-k').text() || $('.e-f-ih').text() || $('[aria-label*="rating"]').text();
        if (ratingCountText) {
            const countMatch = ratingCountText.match(/(\d+(?:,\d+)*)/);
            if (countMatch) {
                cwsInfo.rating_count = parseInt(countMatch[1].replace(/,/g, ''), 10);
            }
        }

        // Extract user count
        const userCount =
            $('.e-f-ih').text() || $('.F-u-j').text() || $('[aria-label*="user"]').text();
        if (userCount) {
            cwsInfo.user_count = userCount.trim();
        }

        // Extract last updated date
        const lastUpdated =
            $('.h-C-b-p-D-md').text() ||
            $('[itemprop="datePublished"]').text() ||
            $('.C-b-p-j-D-J').text();
        if (lastUpdated) {
            cwsInfo.last_updated = lastUpdated.trim();
        }

        // Extract version
        const version =
            $('.C-b-p-D-Xe.h-C-b-p-D-md').text() ||
            $('[itemprop="version"]').text() ||
            $('.h-C-b-p-D-za').text();
        if (version) {
            cwsInfo.version = version.trim();
        }

        // Extract size
        const size = $('.h-C-b-p-D-xh-hh').text() || $('[itemprop="fileSize"]').text();
        if (size) {
            cwsInfo.size = size.trim();
        }

        // Extract languages
        const languagesText = $('.C-b-p-D-Xe-E').text() || $('.e-f-oh').text();
        if (languagesText) {
            const languages = languagesText.split(',').map((lang) => lang.trim());
            if (languages.length > 0 && languages[0]) {
                cwsInfo.languages = languages;
            }
        }

        // Extract developer information
        const developer =
            $('.e-f-Me').text() || $('[itemprop="author"]').text() || $('.C-b-p-D-Xe-D').text();
        if (developer) {
            cwsInfo.developer = developer.trim();
        }

        // Extract developer website
        const developerWebsite = $('.e-f-y a').attr('href') || $('[itemprop="url"]').attr('href');
        if (developerWebsite) {
            cwsInfo.developer_website = developerWebsite.trim();
        }

        // Extract privacy policy
        const privacyPolicy =
            $('a[href*="privacy"]').attr('href') || $('a:contains("Privacy")').attr('href');
        if (privacyPolicy) {
            cwsInfo.privacy_policy = privacyPolicy.trim();
        }

        // Return null if no meaningful data was extracted
        if (Object.keys(cwsInfo).length === 0) {
            logger.debug(null, `No CWS data could be extracted from: ${htmlPath}`);
            return null;
        }

        logger.debug(null, `Successfully extracted CWS info from: ${htmlPath}`, {
            fields_extracted: Object.keys(cwsInfo).length,
        });

        return cwsInfo;
    } catch (error) {
        logger.error(null, `Error parsing CWS HTML file: ${htmlPath}`, {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Attempts to find and parse CWS HTML file from the CWS directory
 * @param extensionDir The extension directory path
 * @returns CWSInfo object if found and parsed, null otherwise
 */
export function findAndParseCWSInfo(extensionDir: string): CWSInfo | null {
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
        return parseCWSHtml(cwsHtmlPath);
    }

    logger.debug(null, `No CWS HTML file found for extension: ${extensionFolderName}`, {
        expected_path: cwsHtmlPath,
        cws_dir: cwsDir,
    });
    return null;
}
