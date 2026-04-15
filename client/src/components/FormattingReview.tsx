import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Flag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

interface FormattingReviewProps {
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  onRefresh: () => void;
}

export default function FormattingReview({
  matterId, phaseName, phaseLabel, onRefresh,
}: FormattingReviewProps) {
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [showAdjustInput, setShowAdjustInput] = useState(false);

  const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName });
  const phase = phaseQuery.data?.phase;
  const versions = phaseQuery.data?.versions ?? [];
  const workflowData = (phase?.workflowData as any) ?? {};

  // Get the formatted version (latest with isFormattingPass)
  const formattedVersion = versions
    .filter((v: any) => v.isFormattingPass === 1)
    .sort((a: any, b: any) => b.versionNumber - a.versionNumber)[0] ?? null;

  // Get the substantive version for comparison
  const substantiveVersionNum = phase?.acceptedSubstantiveVersion ?? workflowData.substantiveVersionNumber;
  const substantiveVersion = substantiveVersionNum
    ? versions.find((v: any) => v.versionNumber === substantiveVersionNum)
    : null;

  // Parse flags from workflowData or version metadata
  const flags: string[] = workflowData.flags ?? (formattedVersion?.metadata as any)?.flags ?? [];
  const hasFlags = flags.length > 0;

  const approveFormatting = trpc.phase.approveFormatting.useMutation({
    onSuccess: (data) => {
      toast.success(`Formatting approved (v${data.officialFinalVersion})`);
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const adjustFormatting = trpc.phase.adjustFormatting.useMutation({
    onSuccess: () => {
      toast.success("Formatting adjustment requested — re-running...");
      setAdjustmentNotes("");
      setShowAdjustInput(false);
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-serif text-xl">{phaseLabel}</CardTitle>
            <CardDescription className="mt-1">
              Claude formatting pass applied — review the formatted document
            </CardDescription>
          </div>
          <Badge className="bg-amber-500 text-white">
            <Flag className="h-3 w-3 mr-1" /> Formatting Review
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {phaseQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !formattedVersion ? (
          <p className="text-muted-foreground text-center py-8">Formatted version not yet available.</p>
        ) : (
          <>
            {/* Flags Panel — only shown if Claude clearly identified flags */}
            {hasFlags && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-700 font-medium text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  Flagged Items ({flags.length})
                </div>
                <ul className="space-y-1.5">
                  {flags.map((flag, i) => (
                    <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">•</span>
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 mt-2">
                  These items were flagged by Claude during the formatting pass. Review and address them before finalizing.
                </p>
              </div>
            )}

            {/* Formatted Document */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium">Formatted Document</h3>
                <Badge variant="outline" className="text-xs">v{formattedVersion.versionNumber}</Badge>
              </div>
              <ScrollArea className="h-[400px] rounded-lg border p-4">
                <div className="prose prose-sm max-w-none">
                  <Streamdown>{formattedVersion.content}</Streamdown>
                </div>
              </ScrollArea>
            </div>

            {/* Source Substantive Version (collapsible reference) */}
            {substantiveVersion && (
              <details className="rounded-lg border p-3">
                <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                  View Source (Substantive v{substantiveVersion.versionNumber})
                </summary>
                <ScrollArea className="h-[250px] mt-3 rounded-lg border p-3 bg-muted/20">
                  <div className="prose prose-sm max-w-none opacity-80">
                    <Streamdown>{substantiveVersion.content}</Streamdown>
                  </div>
                </ScrollArea>
              </details>
            )}

            <Separator />

            {/* Actions */}
            {showAdjustInput ? (
              <div className="space-y-3">
                <Textarea
                  placeholder="Describe the formatting adjustments needed (substantive content will not change)..."
                  value={adjustmentNotes}
                  onChange={(e) => setAdjustmentNotes(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => adjustFormatting.mutate({ matterId, phaseName, notes: adjustmentNotes })}
                    disabled={!adjustmentNotes.trim() || adjustFormatting.isPending}
                  >
                    {adjustFormatting.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Re-run Formatting
                  </Button>
                  <Button variant="ghost" onClick={() => { setShowAdjustInput(false); setAdjustmentNotes(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button
                  onClick={() => approveFormatting.mutate({ matterId, phaseName })}
                  disabled={approveFormatting.isPending}
                  className="flex-1"
                  size="lg"
                >
                  {approveFormatting.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Approve Formatting
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAdjustInput(true)}
                  className="flex-1"
                  size="lg"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Adjust Formatting
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
