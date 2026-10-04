process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://recall:recall@localhost:5432/recall_tracker_test";
process.env.INGEST_USE_FIXTURES = "1";
process.env.DISABLE_QUEUES = "1";
process.env.CONNECTOR_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.OPENFDA_ENDPOINTS = "food,drug,device";
