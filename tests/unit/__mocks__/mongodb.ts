import { MongoClient } from 'mongodb';

const mockConnect = jest.fn();
const mockDb = jest.fn(() => ({
  collection: jest.fn(() => ({
    findOne: jest.fn(),
    find: jest.fn(() => ({ toArray: jest.fn() })),
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    replaceOne: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(() => ({ toArray: jest.fn() })),
  })),
  listCollections: jest.fn(() => ({ toArray: jest.fn() })),
  createCollection: jest.fn(),
}));

const mockClose = jest.fn();

const MockMongoClient = jest.fn(() => ({
  connect: mockConnect,
  db: mockDb,
  close: mockClose,
}));

(MockMongoClient as any).mockConnect = mockConnect;
(MockMongoClient as any).mockDb = mockDb;
(MockMongoClient as any).mockClose = mockClose;

jest.mock('mongodb', () => ({ MongoClient: MockMongoClient }));

export { MockMongoClient };

