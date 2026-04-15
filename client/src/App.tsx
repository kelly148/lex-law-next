import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import Home from "./pages/Home";
import MatterPage from "./pages/MatterPage";
import { Loader2 } from "lucide-react";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-primary text-primary-foreground">
        <div className="container flex h-14 items-center justify-between">
          <a href="/" className="flex items-center gap-3 no-underline">
            <h1 className="font-serif text-xl font-bold tracking-tight text-white">Lex Law Next</h1>
            <span className="text-sm text-primary-foreground/70 hidden sm:inline">AI-Assisted Legal Workflow</span>
          </a>
          <div className="flex items-center gap-4">
            {user && (
              <span className="text-sm text-primary-foreground/80">{user.name || user.email}</span>
            )}
            <button
              onClick={() => logout()}
              className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>
      {/* Main Content */}
      <main>{children}</main>
    </div>
  );
}

function Router() {
  return (
    <AuthGuard>
      <AppLayout>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/matters/:matterId" component={MatterPage} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </AppLayout>
    </AuthGuard>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
