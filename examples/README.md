# Examples

This directory contains example scripts demonstrating various features of ExtPorter.

## Chrome Web Store Metadata Extraction

**File:** `cws_extraction_demo.ts`

This example demonstrates how Chrome Web Store metadata is automatically extracted when loading extensions.

### Running the Example

```bash
npx ts-node examples/cws_extraction_demo.ts
```

### What it demonstrates

1. **Parsing a single HTML file** - Shows how to use `parseCWSHtml()` to extract metadata from a CWS HTML file
2. **Loading extensions with CWS info** - Shows how `find_extensions()` automatically includes CWS metadata
3. **Different HTML filenames** - Demonstrates that the parser supports multiple filename patterns (store.html, cws.html, etc.)

### Example Output

```json
{
  "description": "A powerful ad blocker for Chrome",
  "rating": 4.8,
  "rating_count": 250000,
  "user_count": "5,000,000+ users",
  "last_updated": "Updated: November 15, 2024",
  "developer": "AdBlock Team"
}
```

## Creating Your Own Examples

To add a new example:

1. Create a new `.ts` file in this directory
2. Import the necessary modules from `../migrator/`
3. Add documentation at the top explaining what the example demonstrates
4. Update this README with information about your example

## Notes

- Examples use `/tmp/` directory for temporary files to avoid cluttering the repository
- All examples include cleanup code to remove temporary files
- Examples are self-contained and can be run independently
