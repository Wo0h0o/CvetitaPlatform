import { PageHeader } from "@/components/shared/PageHeader";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { StoresTable } from "@/components/dashboard/StoresTable";
import { ActionRow } from "@/components/dashboard/ActionRow";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Командно табло" />
      <KpiStrip />
      <StoresTable />
      <ActionRow />
    </>
  );
}
