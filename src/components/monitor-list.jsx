import { Server } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { Heartbeat } from "@/components/heartbeat";
import { EmptyState } from "@/components/empty-state";

export function MonitorList({ services, onOpen, empty }) {
  if (!services.length)
    return (
      <EmptyState
        icon={Server}
        title={empty?.title || "No services yet"}
        detail={empty?.detail || "Add a service and CloudOps starts checking it."}
      >
        {empty?.action}
      </EmptyState>
    );
  const traffic = services.some((s) => s.traffic);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Service</TableHead>
          <TableHead className="hidden md:table-cell">Last 30 checks</TableHead>
          <TableHead className="text-right">Response</TableHead>
          {traffic && (
            <>
              <TableHead className="hidden text-right lg:table-cell">Requests (24h)</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Errors</TableHead>
            </>
          )}
          <TableHead className="text-right">Uptime (24h)</TableHead>
          <TableHead className="pr-4 text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {services.map((s) => (
          <TableRow
            key={s.id}
            className="cursor-pointer"
            onClick={() => onOpen(s.id)}
          >
            <TableCell className="max-w-64 pl-4">
              <div className="truncate font-medium">{s.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">
                {s.endpoint}
              </div>
            </TableCell>
            <TableCell className="hidden w-[38%] md:table-cell">
              <Heartbeat history={s.history} count={30} height={18} />
            </TableCell>
            <TableCell className="text-right tabular">
              {s.latency == null ? "—" : `${s.latency} ms`}
            </TableCell>
            {traffic && (
              <>
                <TableCell className="hidden text-right tabular lg:table-cell">
                  {s.traffic ? s.traffic.requests.toLocaleString() : "—"}
                </TableCell>
                <TableCell
                  className={`hidden text-right tabular lg:table-cell ${s.traffic?.errorRate >= 5 ? "font-medium text-danger" : ""}`}
                >
                  {s.traffic ? `${s.traffic.errorRate}%` : "—"}
                </TableCell>
              </>
            )}
            <TableCell className="text-right tabular">
              {s.uptime == null ? "—" : `${s.uptime}%`}
            </TableCell>
            <TableCell className="pr-4 text-right">
              <StatusBadge value={s.enabled ? s.status : "paused"} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
