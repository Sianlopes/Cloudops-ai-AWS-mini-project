import { Inbox } from "lucide-react";

export function EmptyState({ title, detail, icon: Icon = Inbox, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <Icon className="mb-2 size-5 text-muted-foreground" />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>
      {children}
    </div>
  );
}
