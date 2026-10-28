import { useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Section } from "@/components/section";
import { Toolbar } from "@/components/toolbar";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { date, exportCsv } from "@/lib/format";

const levelClass = {
  error: "text-danger",
  warn: "text-warning",
  info: "text-muted-foreground",
};

const typeGroups = {
  all: null,
  checks: ["health_check"],
  requests: ["request"],
  app: ["log", "auth_failure", "cpu"],
};

export function LogsPage({
  logs: all,
  query,
  setQuery,
  level,
  setLevel,
  serviceName,
}) {
  const [type, setType] = useState("all");
  const logs = typeGroups[type]
    ? all.filter((l) => typeGroups[type].includes(l.type))
    : all;
  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="Search messages or trace IDs"
      >
        <Select value={type} onValueChange={setType}>
          <SelectTrigger size="sm" className="w-36" aria-label="Event type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="checks">Health checks</SelectItem>
            <SelectItem value="requests">Requests</SelectItem>
            <SelectItem value="app">App events</SelectItem>
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger size="sm" className="w-32" aria-label="Log level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv("cloudops-logs.csv", logs)}
        >
          <Download /> Export CSV
        </Button>
      </Toolbar>
      <Section>
        {logs.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36 pl-4">Time</TableHead>
                <TableHead className="w-20">Level</TableHead>
                <TableHead className="w-40">Service</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="hidden pr-4 lg:table-cell">
                  Trace ID
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="pl-4 whitespace-nowrap text-muted-foreground tabular">
                    {date(l.at)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-xs font-medium uppercase",
                      levelClass[l.level],
                    )}
                  >
                    {l.level}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {serviceName(l.serviceId)}
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    {l.message}
                  </TableCell>
                  <TableCell className="hidden pr-4 font-mono text-xs text-muted-foreground lg:table-cell">
                    {l.traceId}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={ScrollText}
            title="No matching events"
            detail="Change your search or log level."
          />
        )}
      </Section>
    </div>
  );
}
