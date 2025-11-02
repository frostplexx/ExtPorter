# .env Integration for Clustering Tool

## Overview

The clustering tool now **automatically detects** all configuration from your `.env` file. No command-line arguments needed!

## How It Works

### Automatic Detection

When you run `npm run cluster` without arguments:

1. ✅ Reads `INPUT_DIR` from .env → loads MV2 extensions
2. ✅ Reads `OUTPUT_DIR` from .env → loads MV3 migrated extensions
3. ✅ Reads `MONGODB_URI` from .env → connects to database and loads extensions
4. ✅ Clusters all loaded extensions together
5. ✅ Generates visualization at `./cluster_visualization.html`

### .env Configuration

Your `.env` file should contain:

```env
# Input directory (MV2 extensions)
INPUT_DIR=./tmp/input

# Output directory (MV3 migrated extensions)
OUTPUT_DIR=./tmp/output

# MongoDB connection string
MONGODB_URI=mongodb://admin:password@localhost:27017/migrator
DB_NAME=migrator
```

## Usage Examples

### Simplest Usage (Recommended)

```bash
# Just run it!
npm run cluster
```

Output:

```
🔬 Extension API Clustering Tool

Using configuration from .env file...
  INPUT_DIR: ./tmp/input
  OUTPUT_DIR: ./tmp/output
  MONGODB_URI: configured

Loading extensions from ./tmp/input...
✓ Loaded 10 extensions from filesystem

Loading extensions from database...
✓ Loaded 15 extensions from database

Loading migrated extensions from ./tmp/output...
✓ Loaded 10 extensions from output

Clustering 35 extensions into 5 groups...
✓ Clustering complete

✓ Done! Open ./cluster_visualization.html
```

### With Custom Options

```bash
# Use .env but with 10 clusters
npm run cluster -- --clusters 10

# Use .env but save to different file
npm run cluster -- --viz ./my_analysis.html

# Use .env input/output but skip database
npm run cluster -- --input $INPUT_DIR --output $OUTPUT_DIR
```

### Override .env

```bash
# Use different input directory
npm run cluster -- --input /path/to/other/extensions

# Manual configuration (ignores .env completely)
npm run cluster -- --input ./ext --output ./out --database
```

## Behavior

### No Arguments Provided

```bash
npm run cluster
```

→ Uses INPUT_DIR, OUTPUT_DIR, and MONGODB_URI from .env

### Partial Arguments

```bash
npm run cluster -- --input ./my-ext
```

→ Uses provided input, ignores .env INPUT_DIR
→ Still uses OUTPUT_DIR and MONGODB_URI from .env if not provided

### All Arguments Provided

```bash
npm run cluster -- --input ./ext --output ./out --database
```

→ Uses provided arguments, ignores .env completely

### Explicit .env Mode

```bash
npm run cluster -- --auto
```

→ Forces use of .env even if some arguments are provided

## Environment Variables

### Required for Auto-detection

| Variable      | Purpose                  | Example                              |
| ------------- | ------------------------ | ------------------------------------ |
| `INPUT_DIR`   | MV2 extensions directory | `./tmp/input`                        |
| `OUTPUT_DIR`  | MV3 migrated extensions  | `./tmp/output`                       |
| `MONGODB_URI` | Database connection      | `mongodb://localhost:27017/migrator` |
| `DB_NAME`     | Database name            | `migrator`                           |

### All Are Optional

If a variable is not set:

- `INPUT_DIR` not set → Won't load from filesystem
- `OUTPUT_DIR` not set → Won't load migrated extensions
- `MONGODB_URI` not set → Won't connect to database

**At least one source must be available** (input, output, or database).

## CLI Options

### Source Options (Override .env)

```
--input <path>     Override INPUT_DIR
--output <path>    Override OUTPUT_DIR
--database         Use database (requires MONGODB_URI in .env)
--auto             Force use of .env settings
```

### Clustering Options

```
--clusters <num>   Number of clusters (default: 5)
--viz <file>       Output HTML file (default: ./cluster_visualization.html)
```

### Help

```
--help             Show help message with current .env values
```

## Integration with ExtPorter

The clustering tool uses the **same .env configuration** as the main ExtPorter migration tool:

```env
# These are used by BOTH tools
INPUT_DIR=./tmp/input          # Source extensions
OUTPUT_DIR=./tmp/output        # Migrated extensions
MONGODB_URI=mongodb://...      # Database

# These are used only by ExtPorter
LOG_LEVEL=info
NEW_TAB_SUBFOLDER=false
ENABLE_FAKEIUM_VALIDATION=true
```

### Workflow Integration

```bash
# 1. Migrate extensions (uses INPUT_DIR and OUTPUT_DIR from .env)
npm run migrate

# 2. Analyze results (uses same INPUT_DIR and OUTPUT_DIR automatically)
npm run cluster

# 3. View visualization
open cluster_visualization.html
```

No need to specify paths - everything is configured once in .env!

## Help Output

```bash
npm run cluster -- --help
```

Shows current .env configuration:

```
Usage: npm run cluster [-- options]

The tool automatically detects input/output directories from .env file.

Environment Variables (from .env):
  INPUT_DIR=./tmp/input
  OUTPUT_DIR=./tmp/output
  MONGODB_URI=configured

Examples:
  # Auto-detect everything from .env (recommended)
  npm run cluster

  # Auto-detect with custom cluster count
  npm run cluster -- --clusters 10

  # Override .env with specific path
  npm run cluster -- --input ./my-extensions
```

## Error Handling

### No .env Configuration

```bash
npm run cluster
```

If .env has no paths configured:

```
❌ Error: No extensions loaded.

No paths configured in .env file.
Please set INPUT_DIR, OUTPUT_DIR, or MONGODB_URI in .env

Specify at least one source:
  --input <path>   - Load from filesystem
  --output <path>  - Load from output directory
  --database       - Load from MongoDB
  --auto           - Use .env configuration
```

### Partial .env Configuration

If only `INPUT_DIR` is set in .env:

```
Using configuration from .env file...
  INPUT_DIR: ./tmp/input

Loading extensions from ./tmp/input...
✓ Loaded 10 extensions from filesystem

Clustering 10 extensions into 5 groups...
```

Works fine! Any combination of sources is valid.

## Migration from Old CLI

### Old Way (Manual Paths)

```bash
npm run cluster -- --input ./tmp/input --output ./tmp/output --database
```

### New Way (.env Auto-detection)

```bash
npm run cluster
```

**60% fewer characters to type!**

## Benefits

1. **Consistency** - Same paths for migration and clustering
2. **Simplicity** - No need to remember or type paths
3. **Flexibility** - Can still override when needed
4. **DRY Principle** - Configure once, use everywhere
5. **Integration** - Works seamlessly with ExtPorter workflow

## Troubleshooting

### "No extensions loaded"

Check your .env:

```bash
cat .env | grep -E "INPUT_DIR|OUTPUT_DIR|MONGODB_URI"
```

Make sure at least one is set and points to a valid location.

### "Cannot connect to database"

Check MongoDB is running:

```bash
npm run db:up
```

Verify .env has correct MONGODB_URI:

```env
MONGODB_URI=mongodb://admin:password@localhost:27017/migrator
```

### ".env not loaded"

Make sure you're in the project root directory:

```bash
cd /path/to/ExtPorter
npm run cluster
```

The tool uses `dotenv` which looks for .env in the current directory.

## Summary

The clustering tool now provides:

- ✅ **Zero-configuration** usage with .env
- ✅ **Automatic detection** of input, output, and database
- ✅ **Backwards compatible** with manual CLI arguments
- ✅ **Integrated workflow** with ExtPorter migration
- ✅ **Clear error messages** when configuration is missing
- ✅ **Flexible override** options when needed

**Just run `npm run cluster` and it works!**
