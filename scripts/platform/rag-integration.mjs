// Runs the RAG engine's integration test inside its container, against a temporary database on
// rag-db (not published to the host). It connects as rag_app, so row-level security is in effect.
import { run } from "./lib.mjs";
run("docker", [
  "exec",
  "platform-rag-engine-1",
  "node",
  "--input-type=module",
  "-e",
  'process.env.RAG_TEST_DATABASE_URL = process.env.DATABASE_URL; await import("./src/integration.test.mjs");',
]);
