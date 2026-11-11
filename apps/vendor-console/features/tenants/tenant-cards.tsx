'use client';

import { Card, Tag } from 'antd';
import type { ReactNode } from 'react';
import { Facts } from '@/components/ui/facts';
import { Meter } from '@/components/ui/meter';
import type { RagUsage, Tenant } from '@/lib/api/types';
import { formatMb, formatNumber, formatUsd, nanoUsd } from '@/lib/format';
import { VISION_MODELS, imageCaps } from '@/lib/limits';
import { LOCAL_MODELS } from '@/lib/models';
import { EditImageLimits, EditKnowledgeLimits } from './limits-forms';
import { CreditFlag } from './status';

export function CreditCard({ tenant }: { tenant: Tenant }) {
  const { credit } = tenant;
  return (
    <Card title="Credit" extra={<span className="text-xs text-fg-tertiary">Simulated USD</span>}>
      <div className="text-xs text-fg-tertiary">Available for new requests</div>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums">{formatUsd(credit.remaining)}</span>
        <CreditFlag credit={credit} />
      </div>
      <Facts
        className="mt-6 tabular-nums"
        items={[
          { label: 'Held for running requests', value: formatUsd(credit.reserved) },
          { label: 'Consumed', value: formatUsd(credit.spent) },
          { label: 'Granted in total', value: formatUsd(credit.limit) },
          { label: 'Requests', value: formatNumber(tenant.requests) },
          { label: 'Simulated provider cost', value: formatUsd(tenant.simulatedProviderCost) },
          {
            label: 'Simulated margin',
            value: formatUsd(nanoUsd(credit.spent) - nanoUsd(tenant.simulatedProviderCost)),
          },
        ]}
      />
    </Card>
  );
}

export function PlanCard({ tenant }: { tenant: Tenant }) {
  const { config } = tenant;
  const daily = config.dailyExternalLimits;
  return (
    <Card title="Plan">
      <h3 className="text-xs text-fg-tertiary">Models</h3>
      <ul className="mt-2 divide-y divide-line-secondary">
        {config.models.map((model) => {
          const rate = config.modelRateLimits?.[model];
          return (
            <li key={model} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
              <span className="flex items-center gap-2">
                <code>{model}</code>
                {LOCAL_MODELS.has(model) && <Tag className="me-0">local</Tag>}
              </span>
              {rate && (
                <span className="text-xs text-fg-secondary tabular-nums">
                  {[
                    rate.rpm && `${formatNumber(rate.rpm)} requests/min`,
                    rate.tpm && `${formatNumber(rate.tpm)} tokens/min`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <Facts
        className="mt-4 tabular-nums"
        items={[
          {
            label: 'Daily limit of external models (shared)',
            value: daily
              ? `${formatNumber(daily.requests)} requests · ${formatNumber(daily.tokens)} tokens`
              : 'No limit',
          },
          { label: 'Web / API port', value: `${config.webPort} / ${config.apiPort}` },
        ]}
      />
    </Card>
  );
}

/** A limit's models, flagging those the plan does not include (they have no effect). */
function ModelTags({ models, plan }: { models: string[]; plan: string[] }) {
  if (!models.length) return <span className="text-fg-tertiary">None</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {models.map((model) =>
        plan.includes(model) ? (
          <Tag key={model} className="me-0">
            {model}
          </Tag>
        ) : (
          <Tag key={model} color="warning" className="me-0">
            {model} · not in plan
          </Tag>
        ),
      )}
    </span>
  );
}

const OnOff = ({ on }: { on: boolean }) =>
  on ? (
    <Tag variant="filled" color="success" className="me-0">
      On
    </Tag>
  ) : (
    <Tag variant="filled" className="me-0">
      Off
    </Tag>
  );

export function KnowledgeCard({
  tenant,
  usage,
  usageError,
}: {
  tenant: Tenant;
  usage?: RagUsage;
  usageError?: Error | null;
}) {
  const { rag } = tenant;
  const used =
    usage?.tenants.find((u) => u.tenant === tenant.id) ?? (usage && { documents: 0, textBytes: 0, chunks: 0 });
  const meter = (label: string, value: number | undefined, limit: number, format?: (n: number) => string): ReactNode =>
    value === undefined ? (
      <span className="tabular-nums">— / {format ? format(limit) : formatNumber(limit)}</span>
    ) : (
      <Meter used={value} limit={limit} format={format} label={label} />
    );
  return (
    <Card
      title="Knowledge (RAG) limits"
      extra={
        <span className="flex items-center gap-2">
          <OnOff on={rag.enabled} />
          <EditKnowledgeLimits tenant={tenant} />
        </span>
      }
    >
      <Facts
        items={[
          { label: 'Embedding models', value: <ModelTags models={rag.embeddingModels} plan={tenant.config.models} /> },
          { label: 'File types', value: rag.allowedTypes.map((type) => type.toUpperCase()).join(', ') || 'None' },
          { label: 'Documents', value: meter('Documents', used?.documents, rag.maxDocuments) },
          {
            label: 'Extracted text (MB)',
            value: meter('Extracted text', used && Number(formatMb(used.textBytes)), rag.maxTextMb, (n) =>
              n.toFixed(2),
            ),
          },
          { label: 'Chunks', value: meter('Chunks', used?.chunks, rag.maxTotalChunks) },
          {
            label: 'Per document',
            value: `${rag.maxFileMb} MB file · ${formatNumber(rag.maxChunksPerDocument)} chunks`,
          },
          { label: 'Top-K max', value: rag.maxTopK },
        ]}
      />
      {usageError && (
        <p className="mt-4 text-xs text-fg-tertiary">Current usage is unavailable: {usageError.message}</p>
      )}
    </Card>
  );
}

/** The tenant's images per chat, with the chosen models of its plan that take fewer. */
function ImagesPerChat({ images, plan }: { images: Tenant['images']; plan: string[] }) {
  const fewer = imageCaps(
    images.models.filter((model) => plan.includes(model)),
    images.maxImages,
  );
  if (!fewer.length) return images.maxImages;
  return (
    <span>
      {images.maxImages}
      <span className="ms-1.5 text-fg-tertiary">
        ({fewer.map(({ model, maxImages }) => `${model} ${maxImages}`).join(', ')})
      </span>
    </span>
  );
}

/** "1,120 for local-mock and google-gemini, 2,048 for …": what vendor-control reserves per image. */
const reservedPerImage = [...new Set([...VISION_MODELS.values()].map(({ imageTokens }) => imageTokens))]
  .map(
    (tokens) =>
      `${formatNumber(tokens)} for ${[...VISION_MODELS]
        .filter(([, figures]) => figures.imageTokens === tokens)
        .map(([model]) => model)
        .join(' and ')}`,
  )
  .join(', ');

export function ImagesCard({ tenant }: { tenant: Tenant }) {
  const { images } = tenant;
  return (
    <Card
      title="Image limits"
      extra={
        <span className="flex items-center gap-2">
          <OnOff on={images.enabled} />
          <EditImageLimits tenant={tenant} />
        </span>
      }
    >
      <Facts
        items={[
          { label: 'Models', value: <ModelTags models={images.models} plan={tenant.config.models} /> },
          { label: 'Images per chat', value: <ImagesPerChat images={images} plan={tenant.config.models} /> },
        ]}
      />
      <p className="mt-4 text-xs leading-5 text-fg-tertiary">
        Images stay in the customer&apos;s own storage and reach the model inside the request. Each image is reserved at
        its model&apos;s input tokens per image ({reservedPerImage}) and settled on the provider&apos;s count. A model
        never takes more images a chat than its own.
      </p>
    </Card>
  );
}
