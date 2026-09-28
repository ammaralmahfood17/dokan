import { requireCurrentProjectRole } from '@/lib/project';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const ctx = await requireCurrentProjectRole(['owner']);

  return (
    <SettingsClient
      project={ctx.project}
      projectId={ctx.project.id}
      expiryDaysLeft={ctx.subscriptionDaysLeft}
    />
  );
}
