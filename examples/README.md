# Examples

This directory contains example scripts demonstrating various features of ExtPorter.

## Reports Collection Usage

**File:** `reports_usage.ts`

This example demonstrates how to use the Reports collection to store manual testing information for extensions.

### Running the Example

```bash
npx ts-node examples/reports_usage.ts
```

### What it demonstrates

1. **Creating a new report** - Shows how to create a report for an extension with the `tested` boolean flag
2. **Updating test status** - Demonstrates updating the `tested` field for an existing report
3. **Querying reports** - Shows how to retrieve reports by extension ID or get all reports
4. **Report structure** - Demonstrates the Report interface with extension reference

### Report Structure

```typescript
interface Report {
    id: string; // Unique report ID
    extension_id: string; // Reference to Extension.id
    tested: boolean; // Manual testing status
    created_at: number; // Timestamp when created
    updated_at: number; // Timestamp when last updated
}
```

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
