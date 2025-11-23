db = db.getSiblingDB('migrator');

db.createUser({
    user: 'migratoruser',
    pwd: 'password',
    roles: [
        {
            role: 'readWrite',
            db: 'migrator',
        },
    ],
});

db.createCollection('extensions');
db.extensions.createIndex({ id: 1 }, { unique: true });
db.extensions.createIndex({ migrationStatus: 1 });
db.extensions.createIndex({ manifestVersion: 1 });
db.extensions.createIndex({ interestingness_score: -1 });
db.extensions.createIndex({ mv3_extension_id: 1 });
db.extensions.createIndex({ 'manifest.permissions': 1 });
db.extensions.createIndex({ name: 1 });
db.extensions.createIndex({ 'manifest.name': 1 });

// Add index for logs collection
db.createCollection('logs');
db.logs.createIndex({ 'extension.id': 1 });
db.logs.createIndex({ time: -1 });
