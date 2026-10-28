import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Bordered panel with a compact title row; tables sit flush inside it.
export function Section({ title, description, action, children, className }) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-none", className)}>
      {(title || action) && (
        <div className="flex min-h-14 items-center justify-between gap-4 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">{title}</h2>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}
