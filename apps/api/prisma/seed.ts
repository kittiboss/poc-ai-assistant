import { PrismaClient, PricingStrategy, Provider } from "@prisma/client";

const prisma = new PrismaClient();

const modelSeeds = [
  {
    id: "local-mock",
    displayName: "Local Mock",
    provider: Provider.MOCK,
    providerModelId: "mock-enterprise",
    enabled: true,
    allowedRoles: ["ADMIN", "USER"],
    contextWindow: 8192,
    capabilities: ["chat", "streaming"],
    local: true,
  },
  {
    id: "qwen-local",
    displayName: "Qwen 2.5 1.5B Local",
    provider: Provider.OLLAMA,
    providerModelId: process.env.OLLAMA_MODEL || "qwen2.5:1.5b",
    enabled: false,
    allowedRoles: ["ADMIN", "USER"],
    contextWindow: 32768,
    capabilities: ["chat", "streaming"],
    local: true,
  },
  {
    id: "openai-gpt",
    displayName: "OpenAI GPT",
    provider: Provider.OPENAI,
    providerModelId: "not-configured",
    enabled: false,
    allowedRoles: ["ADMIN"],
    contextWindow: 0,
    capabilities: ["chat"],
    local: false,
  },
  {
    id: "anthropic-claude",
    displayName: "Claude",
    provider: Provider.ANTHROPIC,
    providerModelId: "not-configured",
    enabled: false,
    allowedRoles: ["ADMIN"],
    contextWindow: 0,
    capabilities: ["chat"],
    local: false,
  },
  {
    id: "google-gemini",
    displayName: "Gemini 3.5 Flash-Lite",
    provider: Provider.GEMINI,
    providerModelId: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    enabled: false,
    allowedRoles: ["ADMIN"],
    contextWindow: 1048576,
    capabilities: ["chat", "streaming"],
    local: false,
  },
  {
    id: "groq-llama",
    displayName: "GPT-OSS 20B (Groq)",
    provider: Provider.GROQ,
    providerModelId: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    enabled: false,
    allowedRoles: ["ADMIN"],
    contextWindow: 131072,
    capabilities: ["chat", "streaming"],
    local: false,
  },
  {
    id: "openrouter-free",
    displayName: "OpenRouter Free Models",
    provider: Provider.OPENROUTER,
    providerModelId: process.env.OPENROUTER_MODEL || "openrouter/free",
    enabled: false,
    allowedRoles: ["ADMIN"],
    contextWindow: 200000,
    capabilities: ["chat", "streaming"],
    local: false,
  },
];

type PricingSeed = {
  strategy: PricingStrategy;
  simulationInputRate: number;
  simulationOutputRate: number;
  markupPercent: number;
};

const pricingSeeds: Record<string, PricingSeed> = {
  // 3,000 in / 700 out simulates a $0.01 provider cost and, with 50% markup, a $0.015 customer charge.
  "local-mock": {
    strategy: PricingStrategy.SIMULATION,
    simulationInputRate: 2.5,
    simulationOutputRate: 3.571428571428,
    markupPercent: 50,
  },
  // Free-tier project: actual provider cost is $0. Simulation rates are Google's published paid-tier list price
  // for gemini-3.5-flash-lite (USD per 1M tokens, output includes thinking; checked 2026-10-14) so dashboards show
  // what the same usage would cost if the key's project were billed. Admins must version this if the tier changes.
  "google-gemini": {
    strategy: PricingStrategy.SIMULATION,
    simulationInputRate: 0.3,
    simulationOutputRate: 2.5,
    markupPercent: 0,
  },
};
const defaultPricing: PricingSeed = {
  strategy: PricingStrategy.PASS_THROUGH,
  simulationInputRate: 0,
  simulationOutputRate: 0,
  markupPercent: 0,
};
const SEED_REVISION = 2;

async function main() {
  const permissions = [
    "CHAT_USE",
    "USAGE_READ_OWN",
    "MODEL_MANAGE",
    "PRICING_MANAGE",
    "ADMIN_DASHBOARD",
  ];
  for (const name of permissions)
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  for (const name of ["ADMIN", "USER"])
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  const [roleRows, permissionRows] = await Promise.all([
    prisma.role.findMany(),
    prisma.permission.findMany(),
  ]);
  const userPermissionNames = new Set(["CHAT_USE", "USAGE_READ_OWN"]);
  await prisma.rolePermission.createMany({
    data: roleRows.flatMap((role) =>
      permissionRows
        .filter(
          (permission) =>
            role.name === "ADMIN" || userPermissionNames.has(permission.name),
        )
        .map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
    ),
    skipDuplicates: true,
  });

  for (const model of modelSeeds) {
    await prisma.aIModel.upsert({
      where: { id: model.id },
      update: {
        displayName: model.displayName,
        provider: model.provider,
        providerModelId: model.providerModelId,
        contextWindow: model.contextWindow,
        capabilities: model.capabilities,
        local: model.local,
      },
      create: model,
    });
    const configuration = await prisma.pricingConfiguration.upsert({
      where: { modelId: model.id },
      update: {},
      create: { modelId: model.id },
    });
    const exists = await prisma.pricingVersion.findUnique({
      where: {
        configurationId_version: {
          configurationId: configuration.id,
          version: 1,
        },
      },
    });
    if (!exists) {
      await prisma.pricingVersion.create({
        data: {
          configurationId: configuration.id,
          version: 1,
          ...pricingData(model.id),
        },
      });
    }
  }

  // Revision 2 adds paid-tier simulation for Gemini. Installs seeded earlier get it as a new, appended version,
  // and only while an administrator has not already versioned that model's pricing themselves.
  const revision = await prisma.applicationSetting.findUnique({
    where: { key: "seedRevision" },
  });
  if (Number(revision?.value || 1) < 2) {
    const configuration = await prisma.pricingConfiguration.findUnique({
      where: { modelId: "google-gemini" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const latest = configuration?.versions[0];
    if (
      configuration &&
      latest &&
      latest.createdBy === "system-seed" &&
      latest.strategy !== PricingStrategy.SIMULATION
    ) {
      const created = await prisma.pricingVersion.create({
        data: {
          configurationId: configuration.id,
          version: latest.version + 1,
          ...pricingData("google-gemini"),
        },
      });
      await prisma.auditLog.create({
        data: {
          action: "PRICING_VERSION_CREATE",
          entityType: "PricingConfiguration",
          entityId: configuration.id,
          before: JSON.parse(JSON.stringify(latest)),
          after: JSON.parse(JSON.stringify(created)),
        },
      });
    }
  }
  await prisma.applicationSetting.upsert({
    where: { key: "seedRevision" },
    update: { value: SEED_REVISION },
    create: { key: "seedRevision", value: SEED_REVISION },
  });
  await prisma.applicationSetting.upsert({
    where: { key: "externalProvidersEnabled" },
    update: {},
    create: { key: "externalProvidersEnabled", value: false },
  });
  const personas = [
    [
      "HR Assistant",
      "Answer HR questions from project reference documents. Cite sources and say when a policy is missing.",
    ],
    [
      "IT Helpdesk",
      "Help troubleshoot technical issues with clear, numbered steps. Ask for missing error details.",
    ],
    [
      "Document Summarizer",
      "Summarize the supplied references with key points, decisions and open questions. Cite sources.",
    ],
    [
      "SQL Assistant",
      "Explain and draft SQL. Never claim queries were executed. Prefer read-only examples.",
    ],
    [
      "Email Writer",
      "Draft clear professional emails. Ask for the audience and objective when unclear.",
    ],
    [
      "Thai–English Translator",
      "Translate between Thai and English while preserving meaning, names and tone.",
    ],
  ];
  for (const [i, [name, systemPrompt]] of personas.entries()) {
    await prisma.promptTemplate.upsert({
      where: {
        id: `a1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      },
      update: {},
      create: {
        id: `a1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        name,
        description: systemPrompt,
        systemPrompt,
        allowedModels: [],
        allowedRoles: ["ADMIN", "USER"],
      },
    });
  }
}

function pricingData(modelId: string) {
  const seed = pricingSeeds[modelId] || defaultPricing;
  return {
    strategy: seed.strategy,
    providerInputRate: 0,
    providerOutputRate: 0,
    simulationInputRate: seed.simulationInputRate,
    simulationOutputRate: seed.simulationOutputRate,
    markupPercent: seed.markupPercent,
    currency: "USD",
    createdBy: "system-seed",
  };
}

main().finally(() => prisma.$disconnect());
