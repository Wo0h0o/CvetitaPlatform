import { PageHeader } from "@/components/shared/PageHeader";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { StoreMultiples } from "@/components/dashboard/StoreMultiples";
import { ActionRow } from "@/components/dashboard/ActionRow";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Командно табло" />
      <KpiStrip />
      <StoreMultiples />
      <ActionRow />
    </>
  );
}
