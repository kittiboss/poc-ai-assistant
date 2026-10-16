'use client';

import { Card } from 'antd';

/** A headline number with its icon and label, as on the usage and admin dashboards. */
export function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="shadow-sm" styles={{ body: { padding: 20 } }}>
      <div className="mb-4 inline-flex rounded-brand bg-primary-soft p-2 text-primary">{icon}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-fg-secondary">{label}</div>
    </Card>
  );
}
