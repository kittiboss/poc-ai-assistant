import { PrismaClient, PricingStrategy, Provider } from '@prisma/client';

const prisma = new PrismaClient();

const modelSeeds = [
  { id: 'local-mock', displayName: 'Local Mock', provider: Provider.MOCK, providerModelId: 'mock-enterprise', enabled: true, allowedRoles: ['ADMIN', 'USER'], contextWindow: 8192, capabilities: ['chat', 'streaming'], local: true },
  { id: 'qwen-local', displayName: 'Qwen 2.5 1.5B Local', provider: Provider.OLLAMA, providerModelId: process.env.OLLAMA_MODEL || 'qwen2.5:1.5b', enabled: false, allowedRoles: ['ADMIN', 'USER'], contextWindow: 32768, capabilities: ['chat', 'streaming'], local: true },
  { id: 'openai-gpt', displayName: 'OpenAI GPT', provider: Provider.OPENAI, providerModelId: 'not-configured', enabled: false, allowedRoles: ['ADMIN'], contextWindow: 0, capabilities: ['chat'], local: false },
  { id: 'anthropic-claude', displayName: 'Claude', provider: Provider.ANTHROPIC, providerModelId: 'not-configured', enabled: false, allowedRoles: ['ADMIN'], contextWindow: 0, capabilities: ['chat'], local: false },
  { id: 'google-gemini', displayName: 'Gemini 3.5 Flash-Lite', provider: Provider.GEMINI, providerModelId: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', enabled: false, allowedRoles: ['ADMIN'], contextWindow: 1048576, capabilities: ['chat', 'streaming'], local: false },
];

async function main() {
  const permissions = ['CHAT_USE', 'USAGE_READ_OWN', 'MODEL_MANAGE', 'PRICING_MANAGE', 'ADMIN_DASHBOARD'];
  for (const name of permissions) await prisma.permission.upsert({ where: { name }, update: {}, create: { name } });
  for (const name of ['ADMIN', 'USER']) await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  const [roleRows, permissionRows] = await Promise.all([prisma.role.findMany(), prisma.permission.findMany()]);
  const userPermissionNames = new Set(['CHAT_USE', 'USAGE_READ_OWN']);
  await prisma.rolePermission.createMany({
    data: roleRows.flatMap((role) => permissionRows.filter((permission) => role.name === 'ADMIN' || userPermissionNames.has(permission.name)).map((permission) => ({ roleId: role.id, permissionId: permission.id }))),
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
      where: { modelId: model.id }, update: {}, create: { modelId: model.id },
    });
    const exists = await prisma.pricingVersion.findUnique({
      where: { configurationId_version: { configurationId: configuration.id, version: 1 } },
    });
    if (!exists) {
      await prisma.pricingVersion.create({
        data: {
          configurationId: configuration.id,
          version: 1,
          strategy: model.provider === Provider.MOCK ? PricingStrategy.SIMULATION : PricingStrategy.PASS_THROUGH,
          providerInputRate: 0,
          providerOutputRate: 0,
          simulationInputRate: model.provider === Provider.MOCK ? 2.5 : 0,
          simulationOutputRate: model.provider === Provider.MOCK ? 3.571428571428 : 0,
          markupPercent: model.provider === Provider.MOCK ? 50 : 0,
          currency: 'USD',
          createdBy: 'system-seed',
        },
      });
    }
  }
  await prisma.applicationSetting.upsert({
    where: { key: 'externalProvidersEnabled' }, update: {}, create: { key: 'externalProvidersEnabled', value: false },
  });
}

main().finally(() => prisma.$disconnect());

