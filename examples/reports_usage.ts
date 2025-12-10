/**
 * Example usage of the Reports collection
 *
 * This demonstrates how to create and manage manual testing reports
 * for extensions in the database.
 */

import { Database } from '../migrator/features/database/db_manager';
import { Report } from '../migrator/types/report';

async function exampleReportsUsage() {
    const db = Database.shared;
    await db.init();

    // Example 1: Create a new report for an extension
    const newReport: Report = {
        id: 'report_' + Date.now(), // Generate unique ID
        extension_id: 'example_extension_id_123',
        tested: false,
        created_at: Date.now(),
        updated_at: Date.now(),
    };

    await db.insertReport(newReport);
    console.log('Created new report:', newReport);

    // Example 2: Update the tested status
    await db.updateReportTested('example_extension_id_123', true);
    console.log('Updated report to tested=true');

    // Example 3: Get a report by extension ID
    const report = await db.getReportByExtensionId('example_extension_id_123');
    console.log('Retrieved report:', report);

    // Example 4: Get all reports
    const allReports = await db.getAllReports();
    console.log('Total reports:', allReports?.length);

    await db.close();
}

// Run the example
if (require.main === module) {
    exampleReportsUsage().catch(console.error);
}

export { exampleReportsUsage };
