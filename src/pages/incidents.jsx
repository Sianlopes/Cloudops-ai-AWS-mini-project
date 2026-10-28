import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Section } from "@/components/section";
import { IncidentTable } from "@/components/incident-table";
import { Toolbar } from "@/components/toolbar";
import { exportCsv } from "@/lib/format";

export function IncidentsPage({
  all,
  items,
  active,
  query,
  setQuery,
  filter,
  setFilter,
  serviceName,
  openIncident,
}) {
  const count = (status) => all.filter((i) => i.status === status).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="acknowledged">
              Acknowledged ({count("acknowledged")})
            </TabsTrigger>
            <TabsTrigger value="resolved">
              Resolved ({count("resolved")})
            </TabsTrigger>
            <TabsTrigger value="all">All ({all.length})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Toolbar query={query} setQuery={setQuery} placeholder="Search incidents">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportCsv(
              "cloudops-incidents.csv",
              items.map(({ timeline, ...i }) => ({
                ...i,
                service: serviceName(i.serviceId),
              })),
            )
          }
        >
          <Download /> Export CSV
        </Button>
      </Toolbar>
      <Section>
        <IncidentTable
          items={items}
          serviceName={serviceName}
          onOpen={openIncident}
        />
      </Section>
    </div>
  );
}
