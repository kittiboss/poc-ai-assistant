import { run } from "./lib.mjs";
run("docker", [
  "exec",
  "platform-vendor-control-1",
  "node",
  "--input-type=module",
  "-e",
  'process.env.VENDOR_TEST_DATABASE_URL = process.env.DATABASE_URL; await import("./src/integration.test.mjs");',
]);
