db = db.getSiblingDB('migrator');

db.createUser({
  user: 'admin',
  pwd: 'password',
  roles: [
    {
      role: 'readWrite',
      db: 'migrator'
    }
  ]
});

db.createCollection('extensions');
db.extensions.createIndex({ "id": 1 }, { unique: true });
db.extensions.createIndex({ "migrationStatus": 1 });
db.extensions.createIndex({ "manifestVersion": 1 });
