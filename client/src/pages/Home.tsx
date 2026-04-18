import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PROVIDERS, PHASE_LABELS, type PhaseName } from "@shared/workflow";
import { Plus, Scale, FolderOpen, ChevronRight, CircleDot, Loader2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [matterName, setMatterName] = useState("");
  const [clientName, setClientName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [workflowPath, setWorkflowPath] = useState<"full" | "core_only">("full");

  const mattersQuery = trpc.matter.list.useQuery(undefined, { enabled: !!user });
  const createMatter = trpc.matter.create.useMutation({
    onSuccess: (data) => {
      toast.success("Matter created");
      mattersQuery.refetch();
      setMatterName("");
      setClientName("");
      setJurisdiction("");
      setLocation(`/matters/${data.matter.matterId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Scale className="h-12 w-12 text-primary" />
            </div>
            <CardTitle className="font-serif text-3xl text-primary">Lex Law Next</CardTitle>
            <CardDescription>The Satterwhite Law Firm, PLLC &middot; Alexandria, Virginia</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => { window.location.href = getLoginUrl(); }} size="lg" className="w-full">
              Sign in to continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-serif text-3xl font-bold text-primary">Dashboard</h1>
        <p className="text-muted-foreground mt-1">AI-Assisted Legal Workflow &middot; The Satterwhite Law Firm, PLLC</p>
      </div>

      {/* LLM Provider Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">LLM Providers</CardTitle>
          <CardDescription>Multi-provider competitive drafting status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {PROVIDERS.map(p => (
              <div key={p.key} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <CircleDot className={`h-4 w-4 ${p.enabled ? "text-green-500" : "text-muted-foreground/40"}`} />
                <div className="flex flex-col">
                  <span className={`text-sm font-medium ${p.enabled ? "" : "text-muted-foreground"}`}>{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.model}</span>
                </div>
                <Badge variant={p.enabled ? "default" : "secondary"} className="text-xs">
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* New Matter Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              New Matter
            </CardTitle>
            <CardDescription>Create a new legal matter</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!matterName.trim()) { toast.error("Matter name is required"); return; }
                if (!jurisdiction.trim()) { toast.error("Jurisdiction is required"); return; }
                createMatter.mutate({ matterName: matterName.trim(), clientName: clientName.trim() || undefined, jurisdiction: jurisdiction.trim(), workflowPath });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="matterName">Matter Name</Label>
                <Input
                  id="matterName"
                  placeholder="e.g. Kinsey Property Purchase"
                  value={matterName}
                  onChange={(e) => setMatterName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  id="clientName"
                  placeholder="e.g. John Kinsey"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jurisdiction">Jurisdiction</Label>
                <Input
                  id="jurisdiction"
                  placeholder="e.g. Virginia — Fairfax County"
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workflowPath">Workflow Path</Label>
                <Select value={workflowPath} onValueChange={(v) => setWorkflowPath(v as "full" | "core_only")}>
                  <SelectTrigger id="workflowPath">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full (all 7 phases)</SelectItem>
                    <SelectItem value="core_only">Core Only (skip optional)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createMatter.isPending}>
                {createMatter.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Create Matter
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Matter List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Matters
            </CardTitle>
            <CardDescription>
              {mattersQuery.data ? `${mattersQuery.data.length} matter${mattersQuery.data.length !== 1 ? "s" : ""}` : "Loading..."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mattersQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : mattersQuery.data && mattersQuery.data.length > 0 ? (
              <div className="space-y-2">
                {mattersQuery.data.map((m) => (
                  <button
                    key={m.matterId}
                    onClick={() => setLocation(`/matters/${m.matterId}`)}
                    className="w-full flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{m.matterName || m.matterId}</span>
                        <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-xs shrink-0">
                          {m.status}
                        </Badge>
                      </div>
                      {m.clientName && (
                        <p className="text-sm font-medium text-foreground/80 mt-0.5 truncate">Client: {m.clientName}</p>
                      )}
                      <p className="text-sm text-muted-foreground mt-0.5 truncate">{m.jurisdiction}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Created {new Date(m.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>No matters yet</p>
                <p className="text-sm mt-1">Create your first matter to get started</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
