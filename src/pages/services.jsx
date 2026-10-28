import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/section";
import { MonitorList } from "@/components/monitor-list";
import { Toolbar } from "@/components/toolbar";

export function ServicesPage({
  services,
  total,
  query,
  setQuery,
  openService,
  openAddService,
}) {
  return (
    <div className="flex flex-col gap-4">
      <Toolbar query={query} setQuery={setQuery} placeholder="Search services">
        <span className="text-sm text-muted-foreground">
          {services.length} of {total}
        </span>
      </Toolbar>
      <Section>
        <MonitorList
          services={services}
          onOpen={openService}
          empty={
            total
              ? { title: "No matching services", detail: "Try another search." }
              : {
                  action: (
                    <Button size="sm" className="mt-3" onClick={openAddService}>
                      <Plus /> Add service
                    </Button>
                  ),
                }
          }
        />
      </Section>
    </div>
  );
}
