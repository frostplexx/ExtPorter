import dotenv from 'dotenv';
import { Database } from '../migrator/features/database/db_manager';
import { find_extensions } from '../migrator/utils/find_extensions';
import { Extension } from '../migrator/types/extension';
import { ChromeTester } from '../ext_tester/chrome_tester';
import { exit } from 'process';

async function main() {

    // Load environment variables once at application startup
    dotenv.config();

    if(!process.env.OUTPUT_DIR) {throw new Error("OUTPUT_DIR not set")}


    await Database.shared.init()

    const args = process.argv.slice(2);

    const ext_id = args[0];

    if(!ext_id) {
        console.log("Usage: yarn srcipts:comapre <extension id of migrated extension>")
        exit(1);
    }
    const migrated_ext_path = `${process.env.OUTPUT_DIR}/${ext_id}`;

    const migrated_parsed_ext = find_extensions(migrated_ext_path, true)[0]

    if (!migrated_parsed_ext) {
        console.log(`Could not find migrated extension in ${migrated_ext_path}`);
        return
    }
    const parts = migrated_parsed_ext.manifest_v2_path.split("/")
    console.log(`Loading MV2 extension "${migrated_parsed_ext.name}" (${parts[parts.length - 1]})`);


    const test = await Database.shared.findExtension({
        "mv3_extension_id": ext_id
    })

    if (test) {
        // Convert database document back to Extension
        const mv2_extension: Extension = {
            id: test.id,
            name: test.name,
            manifest_v2_path: test.manifest_v2_path,
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
