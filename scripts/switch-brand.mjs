// Switches the running web to another brand in a few seconds, for demos.
//
//   npm run switch-brand -- acme          switch (builds the brand's image first if there is none)
//   npm run switch-brand -- acme build    rebuild the brand's image, e.g. after pulling, then switch
//   npm run switch-brand                  brands, their images, and the one running now
//
// Plain words rather than --flags: PowerShell drops the `--` before npm sees it, and npm then
// keeps flags for itself. (`node scripts/switch-brand.mjs acme --build` works too.)
//
// The brand is compiled into the web image (NEXT_PUBLIC_BRAND), so each brand is built once into
// its own tag, <frontend image>:brand-<id>. Switching points the image Compose runs at that tag
// and recreates only the frontend container. Builds set NEXT_PUBLIC_BRAND explicitly, so a value
// in .env never decides the brand. Compose files are the ones the running stack was started with
// (Gemini or other overlays included); without a running stack, docker-compose.yml.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandsDir = path.join(root, "apps/web/config/brands");
const webUrl = process.env.WEB_URL || "http://localhost:3000";

function run(command, args, { env, inherit = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: inherit ? "inherit" : "pipe",
  });
  return {
    ok: result.status === 0,
    out: (result.stdout || "").trim(),
    err: (result.stderr || "").trim(),
  };
}

function fail(message) {
  console.error(`switch-brand: ${message}`);
  process.exit(1);
}

/** Brand ids and names from apps/web/config/brands, and whether index.ts registers them. */
function readBrands() {
  const index = readFileSync(path.join(brandsDir, "index.ts"), "utf8");
  return readdirSync(brandsDir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .map((file) => {
      const source = readFileSync(path.join(brandsDir, file), "utf8");
      const id = source.match(/\bid:\s*'([^']+)'/)?.[1];
      const name = source.match(/\bname:\s*'([^']+)'/)?.[1];
      return (
        id && { id, name, registered: new RegExp(`\\b${id}:`).test(index) }
      );
    })
    .filter(Boolean);
}

const frontendContainer = () =>
  run("docker", [
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.service=frontend",
    "--format",
    "{{.ID}}",
  ]).out.split("\n")[0];

/** The Compose files the running stack used, so overlays are kept. */
function composeFiles() {
  const container = frontendContainer();
  const files = container
    ? run("docker", [
        "inspect",
        container,
        "--format",
        '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
      ]).out
    : "";
  return files ? files.split(",") : [path.join(root, "docker-compose.yml")];
}

const compose = (files, ...args) => [
  "compose",
  ...files.flatMap((file) => ["-f", file]),
  ...args,
];

/** Compose names a built image <project>-<service> unless the service sets `image`. */
function frontendImage(files) {
  const config = run("docker", compose(files, "config", "--format", "json"));
  if (!config.ok) fail(`docker compose config failed:\n${config.err}`);
  const { name, services } = JSON.parse(config.out);
  return services.frontend.image || `${name}-frontend`;
}

const imageInfo = (image) => {
  const result = run("docker", [
    "image",
    "inspect",
    image,
    "--format",
    "{{.Id}} {{.Created}}",
  ]);
  if (!result.ok) return null;
  const [id, created] = result.out.split(" ");
  return { id, created: new Date(created) };
};

/** When the web's code last changed in git; an image built before then is stale. */
const lastWebChange = () =>
  new Date(
    run("git", [
      "log",
      "-1",
      "--format=%cI",
      "--",
      "apps/web",
      "packages/shared",
    ]).out,
  );

async function servedTitle() {
  try {
    const response = await fetch(webUrl, { signal: AbortSignal.timeout(2000) });
    return (await response.text()).match(/<title>([^<]*)<\/title>/)?.[1];
  } catch {
    return undefined;
  }
}

const args = process.argv.slice(2);
const brands = readBrands();
const files = composeFiles();
const image = frontendImage(files);
const tag = (id) => `${image}:brand-${id}`;

const [id, action] = args.filter((arg) => !arg.startsWith("-"));
const rebuild = action === "build" || args.includes("--build");

if (!id || id === "list" || args.includes("--list")) {
  const container = frontendContainer();
  const running = container
    ? run("docker", ["inspect", container, "--format", "{{.Image}}"]).out
    : "";
  const changed = lastWebChange();
  console.log(`Brands (image ${image}:brand-<id>):`);
  for (const brand of brands) {
    const info = imageInfo(tag(brand.id));
    const state = !brand.registered
      ? "not registered in apps/web/config/brands/index.ts"
      : !info
        ? "no image yet"
        : `built ${info.created.toLocaleString()}${info.created < changed ? " (older than the web code: add build)" : ""}`;
    const current = info && info.id === running ? "  ← running" : "";
    console.log(
      `  ${brand.id.padEnd(12)} ${brand.name.padEnd(22)} ${state}${current}`,
    );
  }
  console.log("\nUsage: npm run switch-brand -- <id> [build]");
  process.exit(0);
}

const brand = brands.find((item) => item.id === id);
if (!brand)
  fail(
    `unknown brand "${id}". Available: ${brands.map((item) => item.id).join(", ")}.`,
  );
if (!brand.registered)
  fail(`register "${id}" in apps/web/config/brands/index.ts first.`);

let info = imageInfo(tag(id));
if (rebuild || !info) {
  console.log(`Building the web for brand "${id}" (about 1–2 minutes)…`);
  // Set here, so it wins over NEXT_PUBLIC_BRAND in .env.
  const build = run("docker", compose(files, "build", "frontend"), {
    env: { NEXT_PUBLIC_BRAND: id },
    inherit: true,
  });
  if (!build.ok) fail("the build failed (see above).");
  run("docker", ["tag", `${image}:latest`, tag(id)]);
  info = imageInfo(tag(id));
} else if (info.created < lastWebChange()) {
  console.warn(
    `Note: the "${id}" image was built before the latest web change; run "npm run switch-brand -- ${id} build" to include it.`,
  );
}

const started = Date.now();
run("docker", ["tag", tag(id), `${image}:latest`]);
const up = run(
  "docker",
  compose(files, "up", "-d", "--no-deps", "--force-recreate", "frontend"),
);
if (!up.ok) {
  if (
    /ports are not available|address already in use|Only one usage/i.test(
      up.err,
    )
  )
    fail(
      "port 3000 is held by another program, often a `next dev` left running. Stop it, then run this again.",
    );
  fail(`docker compose up failed:\n${up.err}`);
}

// The container is up within a second or two; wait until the page itself shows the new brand.
let title;
while (Date.now() - started < 60_000) {
  title = await servedTitle();
  if (title === brand.name) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (title !== brand.name)
  fail(
    `${webUrl} still shows "${title ?? "nothing"}" after ${seconds} s. Check that nothing else serves port 3000.`,
  );
console.log(
  `${webUrl} now shows "${brand.name}" (${seconds} s). Reload open tabs; use a private window to see the brand's default language and theme.`,
);
