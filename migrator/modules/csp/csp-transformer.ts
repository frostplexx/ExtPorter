/**
 * Makes a CSP string compliant with MV3 restrictions
 * Removes or replaces non-compliant values in script-src, object-src, and worker-src
 * @param csp The CSP string to make compliant
 * @returns A compliant CSP string
 */
export function makeCSPStringCompliant(csp: string): string {
    // Allowed values for script-src, object-src, and worker-src in MV3
    const allowedValues = new Set([
        "'self'",
        "'none'",
        "'wasm-unsafe-eval'",
        // Localhost sources (for unpacked extensions)
        'http://localhost',
        'http://127.0.0.1',
        'https://localhost',
        'https://127.0.0.1',
    ]);

    // Parse the CSP into directives
    const directives = csp
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
    const transformedDirectives: string[] = [];

    for (const directive of directives) {
        const parts = directive.split(/\s+/);
        if (parts.length === 0) continue;

        const directiveName = parts[0].toLowerCase();

        // Skip invalid directive names (must end with -src or be 'sandbox')
        const validDirectivePattern = /-src$|^sandbox$/;
        if (!validDirectivePattern.test(directiveName)) {
            // Skip this invalid directive
            continue;
        }

        const directiveValues = parts.slice(1);

        // Directives that need to be restricted in MV3
        if (
            directiveName === 'script-src' ||
            directiveName === 'object-src' ||
            directiveName === 'worker-src'
        ) {
            const compliantValues = filterCompliantValues(directiveValues, allowedValues);

            // Ensure at least 'self' is present if no compliant values remain
            if (compliantValues.length === 0) {
                compliantValues.push("'self'");
            }

            transformedDirectives.push(`${directiveName} ${compliantValues.join(' ')}`);
        }
        // For style-src, remove unsafe-inline and unsafe-eval
        else if (directiveName === 'style-src') {
            const filteredValues = directiveValues.filter(
                (v) =>
                    !v.toLowerCase().includes('unsafe-inline') &&
                    !v.toLowerCase().includes('unsafe-eval')
            );
            if (filteredValues.length > 0) {
                transformedDirectives.push(`${directiveName} ${filteredValues.join(' ')}`);
            }
        }
        // Other directives can be kept as-is
        else {
            transformedDirectives.push(directive);
        }
    }

    // Ensure required directives exist
    const hasScriptSrc = transformedDirectives.some((d) =>
        d.toLowerCase().startsWith('script-src')
    );
    const hasObjectSrc = transformedDirectives.some((d) =>
        d.toLowerCase().startsWith('object-src')
    );

    if (!hasScriptSrc) {
        transformedDirectives.push("script-src 'self'");
    }
    if (!hasObjectSrc) {
        transformedDirectives.push("object-src 'self'");
    }

    return transformedDirectives.join('; ');
}

/**
 * Filters directive values to only include MV3-compliant values
 * @param values The directive values to filter
 * @param allowedValues Set of allowed values
 * @returns Array of compliant values
 */
function filterCompliantValues(values: string[], allowedValues: Set<string>): string[] {
    const compliantValues: string[] = [];

    for (const value of values) {
        const valueLower = value.toLowerCase();

        // Check if it's an explicitly allowed value
        if (allowedValues.has(valueLower)) {
            compliantValues.push(value);
            continue;
        }

        // Check for localhost with port (e.g., http://localhost:8080)
        if (valueLower.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/)) {
            compliantValues.push(value);
            continue;
        }

        // Skip any other values (they are non-compliant):
        // - 'unsafe-eval'
        // - 'unsafe-inline'
        // - Remote URLs
        // - Wildcards
        // - Hash or nonce values (should be kept, but checking for them)
        if (valueLower.startsWith("'sha") || valueLower.startsWith("'nonce-")) {
            // Hashes and nonces are allowed in MV3
            compliantValues.push(value);
        }
    }

    return compliantValues;
}
