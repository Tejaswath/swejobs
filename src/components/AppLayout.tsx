import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Activity,
  Compass,
  ClipboardList,
  LogOut,
  LogIn,
  ChevronDown,
  Search,
  Download,
  Target,
  Bookmark,
  MoreHorizontal,
  Menu,
  Settings,
  User,
  Mail,
} from "lucide-react";
import { useState, useEffect } from "react";

const NAV_ITEMS = [
  { path: "/", label: "Overview", icon: Activity },
  { path: "/jobs", label: "Explore", icon: Compass },
  { path: "/applications", label: "Applications", icon: ClipboardList },
  { path: "/outreach", label: "Outreach", icon: Mail },
];

const MORE_ITEMS = [
  { path: "/tracked", label: "Shortlist", icon: Bookmark },
  { path: "/resumes", label: "Resume Library", icon: User },
  { path: "/skills", label: "Skill Gap", icon: Target },
  { path: "/searches", label: "Saved Searches", icon: Bookmark },
  { path: "/export", label: "Export Data", icon: Download },
  { path: "/admin", label: "Admin", icon: Settings },
];

const COMMAND_ITEMS = [
  ...NAV_ITEMS,
  ...MORE_ITEMS,
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const userEmail = user?.email ?? "";
  const userInitial = userEmail.charAt(0).toUpperCase() || "U";
  const moreActive = MORE_ITEMS.some((item) => location.pathname.startsWith(item.path));

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation menu"
                  className="h-9 w-9 rounded-xl text-muted-foreground md:hidden"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-sm">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <Activity className="h-4.5 w-4.5 text-primary" />
                    </div>
                    SweJobs
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1">
                  {NAV_ITEMS.map((item) => {
                    const isActive = item.path === "/"
                      ? location.pathname === "/"
                      : location.pathname.startsWith(item.path);
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                  <div className="my-2 h-px bg-border/40" />
                  <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">More</p>
                  {MORE_ITEMS.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>

            <Link to="/" className="flex items-center gap-3 text-sm font-semibold tracking-tight text-foreground">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <Activity className="h-4.5 w-4.5 text-primary" />
              </div>
              <span className="hidden sm:inline text-base">SweJobs</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);
              return (
                <Link key={item.path} to={item.path}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={`h-10 gap-1.5 rounded-xl px-4 text-sm ${
                      isActive
                        ? "relative border border-border/60 bg-secondary/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-primary"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}

            {/* More dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={moreActive ? "secondary" : "ghost"}
                  size="sm"
                  className={`h-10 gap-1.5 rounded-xl px-4 text-sm ${
                    moreActive
                      ? "relative border border-border/60 bg-secondary/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-primary"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  }`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {MORE_ITEMS.map((item) => (
                  <DropdownMenuItem key={item.path} onClick={() => navigate(item.path)} className="gap-2 text-xs">
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="flex items-center gap-2">
            {/* ⌘K — hidden on mobile */}
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open command palette"
              onClick={() => setCmdOpen(true)}
              className="hidden h-10 gap-2 rounded-xl border border-border/60 bg-background/45 px-3 text-sm text-muted-foreground hover:bg-background/70 hover:text-foreground md:flex"
            >
              <Search className="h-3.5 w-3.5" />
              <kbd className="pointer-events-none rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
            </Button>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-10 gap-2 rounded-xl border border-border/60 bg-background/45 px-3 text-sm text-muted-foreground hover:bg-background/70 hover:text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {userInitial}
                    </span>
                    <span className="hidden max-w-[160px] truncate lg:inline">{userEmail}</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as</DropdownMenuLabel>
                  <DropdownMenuLabel className="truncate text-xs font-normal">{userEmail}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => {
                      void signOut();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link to="/auth">
                <Button variant="ghost" size="sm" className="h-10 gap-1.5 rounded-xl border border-border/60 bg-background/45 px-3 text-sm text-muted-foreground hover:bg-background/70 hover:text-foreground">
                  <LogIn className="h-3 w-3" /> Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">{children}</main>

      <footer className="border-t border-border/40 bg-background/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <p className="text-xs text-muted-foreground">SweJobs</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Link to="/jobs" className="hover:text-foreground">Explore</Link>
            <Link to="/applications" className="hover:text-foreground">Applications</Link>
            <Link to="/outreach" className="hover:text-foreground">Outreach</Link>
          </div>
        </div>
      </footer>

      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Go to..." />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {COMMAND_ITEMS.map((item) => (
              <CommandItem key={item.path} onSelect={() => { navigate(item.path); setCmdOpen(false); }}>
                <item.icon className="mr-2 h-3.5 w-3.5" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
