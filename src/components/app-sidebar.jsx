import {
  Activity,
  BookOpen,
  ChevronsUpDown,
  Cloud,
  LayoutDashboard,
  LogOut,
  Server,
  Settings,
  SlidersHorizontal,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const navigation = [
  ["Overview", LayoutDashboard],
  ["Services", Server],
  ["Incidents", TriangleAlert],
  ["Metrics", Activity],
  ["Logs", Terminal],
  ["Monitoring rules", SlidersHorizontal],
];

function NavButton({ icon: Icon, selected, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        selected
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="flex-1 text-left">{children}</span>
      {count > 0 && (
        <span className="rounded-md bg-danger/10 px-1.5 text-xs font-medium text-danger tabular">
          {count}
        </span>
      )}
    </button>
  );
}

export function AppSidebar({
  page,
  onNavigate,
  activeCount,
  workspace,
  email,
  workerHealthy,
  onGuide,
  onSignOut,
}) {
  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-3">
      <button
        onClick={() => onNavigate("Overview")}
        className="flex items-center gap-2.5 px-2 pt-1"
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Cloud className="size-4" />
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-sm leading-tight font-semibold">
            CloudOps
          </span>
          <span className="block truncate text-xs leading-tight text-muted-foreground">
            {workspace}
          </span>
        </span>
      </button>
      <nav className="flex flex-col gap-0.5">
        {navigation.map(([label, Icon]) => (
          <NavButton
            key={label}
            icon={Icon}
            selected={page === label}
            onClick={() => onNavigate(label)}
            count={label === "Incidents" ? activeCount : 0}
          >
            {label}
          </NavButton>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <div className="mb-2 flex items-center gap-2 px-2.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              workerHealthy ? "bg-success" : "bg-danger",
            )}
          />
          {workerHealthy ? "Monitoring worker online" : "Worker offline"}
        </div>
        <NavButton icon={BookOpen} onClick={onGuide}>
          Getting started
        </NavButton>
        <NavButton
          icon={Settings}
          selected={page === "Settings"}
          onClick={() => onNavigate("Settings")}
        >
          Settings
        </NavButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mt-2 flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-sidebar-accent">
              <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                AD
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-tight">Administrator</span>
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {email}
                </span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
