import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
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
  Kanban,
  Moon,
  Sun,
  LogOut,
  LogIn,
  Search,
  BarChart3,
  Download,
  Target,
  Building,
  Bookmark,
  MoreHorizontal,
  Menu,
} from "lucide-react";
import { useState, useEffect } from "react";

const NAV_ITEMS = [
  { path: "/", label: "Overview", icon: Activity },
  { path: "/jobs", label: "Explore", icon: Compass },
  { path: "/tracked", label: "Tracker", icon: Kanban },
];

const MORE_ITEMS = [
  { path: "/skills", label: "Skill Gap", icon: Target },
  { path: "/watchlist", label: "Company Watchlist", icon: Building },
  { path: "/digest", label: "Market Digest", icon: BarChart3 },
  { path: "/searches", label: "Saved Searches", icon: Bookmark },
  { path: "/export", label: "Export Data", icon: Download },
];

const COMMAND_ITEMS = [
  ...NAV_ITEMS,
  ...MORE_ITEMS,
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 glass">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden text-muted-foreground">
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
                  <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">More</p>
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

            <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Activity className="h-4.5 w-4.5 text-primary" />
              </div>
              <span className="hidden sm:inline text-base">SweJobs</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive = item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);
              return (
                <Link key={item.path} to={item.path}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={`gap-1.5 text-xs h-8 px-3 ${
                      isActive ? "" : "text-muted-foreground hover:text-foreground"
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
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8 px-3 text-muted-foreground hover:text-foreground">
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

          <div className="flex items-center gap-1">
            {/* ⌘K — hidden on mobile */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCmdOpen(true)}
              className="hidden md:flex h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3 w-3" />
              <kbd className="pointer-events-none rounded border border-border/60 bg-muted/50 px-1 py-0.5 font-mono text-[9px]">⌘K</kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </Button>
            {user ? (
              <Button variant="ghost" size="sm" onClick={signOut} className="gap-1 text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground">
                <LogOut className="h-3 w-3" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            ) : (
              <Link to="/auth">
                <Button variant="ghost" size="sm" className="gap-1 text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground">
                  <LogIn className="h-3 w-3" /> Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-6">{children}</main>

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
