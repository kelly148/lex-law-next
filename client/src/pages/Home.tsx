import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { PROVIDERS } from "@shared/workflow";
import {
  Plus, Scale, FolderOpen, ChevronRight, CircleDot, Loader2,
  Trash2, Archive, ArchiveRestore, MoreVertical, FolderPlus,
  Folder, FolderX, Pencil, Check, X,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";

// ── Colour palette for folders ────────────────────────────────────────
const FOLDER_COLORS = [
  "#2E75B6", "#1F3864", "#C0392B", "#27AE60",
  "#8E44AD", "#E67E22", "#16A085", "#2C3E50",
];

// ── Folder sidebar item ───────────────────────────────────────────────
function FolderItem({
  folder,
  count,
  selected,
  onClick,
  onRename,
  onDelete,
}: {
  folder: { folderId: string; name: string; color: string };
  count: number;
  selected: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  const commit = () => {
    if (draft.trim() && draft.trim() !== folder.name) onRename(draft.trim());
    setEditing(false);
  };

  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors
        ${selected ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"}`}
      onClick={() => { if (!editing) onClick(); }}
    >
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: folder.color }} />
      {editing ? (
        <input
          autoFocus
          className="flex-1 bg-transparent border-b border-primary outline-none text-sm"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate">{folder.name}</span>
      )}
      <span className="text-xs text-muted-foreground shrink-0">{count}</span>
      {!editing && (
        <div className="opacity-0 group-hover:opacity-100 flex gap-0.5" onClick={e => e.stopPropagation()}>
          <button className="p-0.5 rounded hover:bg-accent" onClick={() => { setDraft(folder.name); setEditing(true); }}>
            <Pencil className="h-3 w-3" />
          </button>
          <button className="p-0.5 rounded hover:bg-destructive/20 text-destructive" onClick={onDelete}>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Form state
  const [matterName, setMatterName] = useState("");
  const [clientName, setClientName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [workflowPath, setWorkflowPath] = useState<"full" | "core_only">("full");

  // Filter / selection state
  const [selectedFilter, setSelectedFilter] = useState<"all" | "active" | "archived" | string>("active");
  const [showArchived, setShowArchived] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // New folder dialog
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);

  // Assign folder dialog
  const [assignTarget, setAssignTarget] = useState<string | null>(null);

  // tRPC queries
  const mattersQuery = trpc.matter.list.useQuery(undefined, { enabled: !!user });
  const foldersQuery = trpc.folder.list.useQuery(undefined, { enabled: !!user });
  const utils = trpc.useUtils();

  // Mutations
  const createMatter = trpc.matter.create.useMutation({
    onSuccess: (data) => {
      toast.success("Matter created");
      utils.matter.list.invalidate();
      setMatterName(""); setClientName(""); setJurisdiction("");
      setLocation(`/matters/${data.matter.matterId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMatter = trpc.matter.delete.useMutation({
    onSuccess: () => { toast.success("Matter deleted"); utils.matter.list.invalidate(); setDeleteTarget(null); },
    onError: (err) => toast.error(err.message),
  });

  const archiveMatter = trpc.matter.archive.useMutation({
    onSuccess: () => { toast.success("Matter archived"); utils.matter.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const unarchiveMatter = trpc.matter.unarchive.useMutation({
    onSuccess: () => { toast.success("Matter restored"); utils.matter.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const assignFolder = trpc.matter.assignFolder.useMutation({
    onSuccess: () => { utils.matter.list.invalidate(); setAssignTarget(null); },
    onError: (err) => toast.error(err.message),
  });

  const createFolder = trpc.folder.create.useMutation({
    onSuccess: () => {
      toast.success("Folder created");
      utils.folder.list.invalidate();
      setNewFolderOpen(false);
      setNewFolderName("");
    },
    onError: (err) => toast.error(err.message),
  });

  const renameFolder = trpc.folder.rename.useMutation({
    onSuccess: () => utils.folder.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const deleteFolder = trpc.folder.delete.useMutation({
    onSuccess: () => {
      toast.success("Folder deleted");
      utils.folder.list.invalidate();
      utils.matter.list.invalidate();
      if (selectedFilter !== "all" && selectedFilter !== "active" && selectedFilter !== "archived") {
        setSelectedFilter("active");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Derived data
  const folders = foldersQuery.data ?? [];
  const allMatters = mattersQuery.data ?? [];

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of allMatters) {
      if (m.folderId) counts[m.folderId] = (counts[m.folderId] ?? 0) + 1;
    }
    return counts;
  }, [allMatters]);

  const filteredMatters = useMemo(() => {
    if (selectedFilter === "all") return allMatters;
    if (selectedFilter === "active") return allMatters.filter(m => m.status !== "archived");
    if (selectedFilter === "archived") return allMatters.filter(m => m.status === "archived");
    // folder id
    return allMatters.filter(m => m.folderId === selectedFilter && m.status !== "archived");
  }, [allMatters, selectedFilter]);

  const activeCount = allMatters.filter(m => m.status !== "archived").length;
  const archivedCount = allMatters.filter(m => m.status === "archived").length;

  // ── Loading / auth guards ────────────────────────────────────────────
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
    <div className="container py-6 space-y-6">
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

      <div className="grid gap-6 lg:grid-cols-4">
        {/* ── Left column: New Matter form ─────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
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
                  createMatter.mutate({
                    matterName: matterName.trim(),
                    clientName: clientName.trim() || undefined,
                    jurisdiction: jurisdiction.trim(),
                    workflowPath,
                  });
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
                  <Label htmlFor="clientName">
                    Client Name <span className="text-muted-foreground text-xs">(optional)</span>
                  </Label>
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
                  {createMatter.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    : <Plus className="h-4 w-4 mr-2" />}
                  Create Matter
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* ── Folder sidebar ───────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Folder className="h-4 w-4" /> Organize
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setNewFolderOpen(true)}
                  title="New folder"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-0.5 pt-0">
              {/* Built-in filters */}
              <div
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors
                  ${selectedFilter === "active" ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"}`}
                onClick={() => setSelectedFilter("active")}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Active</span>
                <span className="text-xs text-muted-foreground">{activeCount}</span>
              </div>
              <div
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors
                  ${selectedFilter === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"}`}
                onClick={() => setSelectedFilter("all")}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">All Matters</span>
                <span className="text-xs text-muted-foreground">{allMatters.length}</span>
              </div>
              <div
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors
                  ${selectedFilter === "archived" ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"}`}
                onClick={() => setSelectedFilter("archived")}
              >
                <Archive className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Archived</span>
                <span className="text-xs text-muted-foreground">{archivedCount}</span>
              </div>

              {/* User folders */}
              {folders.length > 0 && (
                <div className="pt-2 mt-1 border-t space-y-0.5">
                  {folders.map(f => (
                    <FolderItem
                      key={f.folderId}
                      folder={f}
                      count={folderCounts[f.folderId] ?? 0}
                      selected={selectedFilter === f.folderId}
                      onClick={() => setSelectedFilter(f.folderId)}
                      onRename={(name) => renameFolder.mutate({ folderId: f.folderId, name })}
                      onDelete={() => deleteFolder.mutate({ folderId: f.folderId })}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column: Matter list ─────────────────────────────── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              {selectedFilter === "active" ? "Active Matters"
                : selectedFilter === "archived" ? "Archived Matters"
                : selectedFilter === "all" ? "All Matters"
                : (folders.find(f => f.folderId === selectedFilter)?.name ?? "Matters")}
            </CardTitle>
            <CardDescription>
              {filteredMatters.length} matter{filteredMatters.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mattersQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : filteredMatters.length > 0 ? (
              <div className="space-y-2">
                {filteredMatters.map((m) => {
                  const folder = folders.find(f => f.folderId === m.folderId);
                  return (
                    <div
                      key={m.matterId}
                      className="flex items-center gap-2 rounded-lg border p-4 hover:bg-accent/30 transition-colors"
                    >
                      {/* Clickable area */}
                      <button
                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                        onClick={() => setLocation(`/matters/${m.matterId}`)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{m.matterName || m.matterId}</span>
                            <Badge
                              variant={m.status === "active" ? "default" : "secondary"}
                              className="text-xs shrink-0"
                            >
                              {m.status}
                            </Badge>
                            {folder && (
                              <span
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full shrink-0"
                                style={{ backgroundColor: folder.color + "22", color: folder.color }}
                              >
                                <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ backgroundColor: folder.color }} />
                                {folder.name}
                              </span>
                            )}
                          </div>
                          {m.clientName && (
                            <p className="text-sm font-medium text-foreground/80 mt-0.5 truncate">
                              Client: {m.clientName}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground mt-0.5 truncate">{m.jurisdiction}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Created {new Date(m.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                      </button>

                      {/* Actions dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* Folder assignment */}
                          <DropdownMenuItem onClick={() => setAssignTarget(m.matterId)}>
                            <Folder className="h-4 w-4 mr-2" /> Move to folder
                          </DropdownMenuItem>
                          {m.folderId && (
                            <DropdownMenuItem onClick={() => assignFolder.mutate({ matterId: m.matterId, folderId: null })}>
                              <FolderX className="h-4 w-4 mr-2" /> Remove from folder
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {/* Archive / Unarchive */}
                          {m.status !== "archived" ? (
                            <DropdownMenuItem onClick={() => archiveMatter.mutate({ matterId: m.matterId })}>
                              <Archive className="h-4 w-4 mr-2" /> Archive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => unarchiveMatter.mutate({ matterId: m.matterId })}>
                              <ArchiveRestore className="h-4 w-4 mr-2" /> Restore
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {/* Delete */}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(m.matterId)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>No matters here</p>
                <p className="text-sm mt-1">
                  {selectedFilter === "archived"
                    ? "No archived matters"
                    : selectedFilter === "active"
                    ? "Create your first matter to get started"
                    : "No matters in this folder"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Delete confirmation dialog ─────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete matter permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the matter and all its phases, drafts, feedback, and uploaded files.
              This action cannot be undone. Consider archiving instead if you may need it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMatter.mutate({ matterId: deleteTarget })}
              disabled={deleteMatter.isPending}
            >
              {deleteMatter.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── New folder dialog ──────────────────────────────────────── */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Folder name</Label>
              <Input
                placeholder="e.g. Real Estate, Corporate"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newFolderName.trim()) {
                    createFolder.mutate({ name: newFolderName.trim(), color: newFolderColor });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${newFolderColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewFolderColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!newFolderName.trim()) { toast.error("Folder name is required"); return; }
                createFolder.mutate({ name: newFolderName.trim(), color: newFolderColor });
              }}
              disabled={createFolder.isPending}
            >
              {createFolder.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Assign folder dialog ───────────────────────────────────── */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move to folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2">
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No folders yet. Create one first using the + button in the sidebar.
              </p>
            ) : (
              folders.map(f => (
                <button
                  key={f.folderId}
                  className="w-full flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50 text-sm text-left"
                  onClick={() => {
                    if (assignTarget) assignFolder.mutate({ matterId: assignTarget, folderId: f.folderId });
                  }}
                >
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                  {f.name}
                  <span className="ml-auto text-xs text-muted-foreground">{folderCounts[f.folderId] ?? 0} matters</span>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
