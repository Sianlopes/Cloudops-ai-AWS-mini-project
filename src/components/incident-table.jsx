import { CheckCircle2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { since } from "@/lib/format";

export function IncidentTable({ items, serviceName, onOpen }) {
  if (!items.length)
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No incidents"
        detail="Incidents appear here when a monitoring rule trips."
      />
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Incident</TableHead>
          <TableHead>Service</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-4 text-right">Detected</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((i) => (
          <TableRow
            key={i.id}
            className="cursor-pointer"
            onClick={() => onOpen(i.id)}
          >
            <TableCell className="pl-4">
              <div className="font-medium">{i.title}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {i.id}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {serviceName(i.serviceId)}
            </TableCell>
            <TableCell>
              <StatusBadge value={i.severity} />
            </TableCell>
            <TableCell>
              <StatusBadge value={i.status} />
            </TableCell>
            <TableCell className="pr-4 text-right whitespace-nowrap text-muted-foreground">
              {since(i.detectedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
