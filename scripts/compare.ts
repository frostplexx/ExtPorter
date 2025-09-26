import { Database } from "../features/database/db_manager";
import { ChromeTester } from "../features/extension_tester/chrome_tester";
import { Extension } from "../types/extension";
import { find_extensions } from "../utils/find_extensions";

import dotenv from 'dotenv';

async function main() {

    // Load environment variables once at application startup
    dotenv.config();
    await Database.shared.init()

    const args = process.argv.slice(2);

    const migrated_ext_path = args[0];

    var migrated_parsed_ext = find_extensions(migrated_ext_path, true)[0]

    if (!migrated_parsed_ext) {
        console.log(`Could not find migrated extension in ${migrated_ext_path}`);
        return
    }
    var parts = migrated_parsed_ext.manifest_path.split("/")
    console.log(`Loading MV2 extension "${migrated_parsed_ext.name}" (${parts[parts.length - 1]})`);


    const test = await Database.shared.findExtension({
        "id": parts[parts.length - 1]
    })

    if (test) {
        // Convert database document back to Extension
        const mv2_extension: Extension = {
            id: test.id,
            name: test.name,
            manifest_path: test.manifest_path,
            manifest: test.manifest,
            files: test.files || [],
            isNewTabExtension: test.isNewTabExtension,
            mv3_extension_id: test.mv3_extension_id
        };

        console.log(`Found MV2 extension: ${mv2_extension.name}`);


        console.log("MV3 browser will be red")
        console.log("MV2 browser will be blue")

        // Launch both browsers simultaneously by creating separate instances
        
        const mv3Tester = new ChromeTester();
        const mv2Tester = new ChromeTester();
        
        // Launch both in parallel
        await Promise.all([
            (async () => {
                console.log("Starting MV3 browser (red)...");
                await mv3Tester.initBrowser(migrated_parsed_ext, 3, true);
                await mv3Tester.injectColor("red");
                await mv3Tester.navigateTo("https://www.nytimes.com/");
            })(),
            (async () => {
                console.log("Starting MV2 browser (blue)...");
                await mv2Tester.initBrowser(mv2_extension, 3, true);
                await mv2Tester.injectColor("blue");
                await mv2Tester.navigateTo("https://www.nytimes.com/");
            })()
        ]);

    }

}



main()
