import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { PROVIDERS } from "@shared/workflow";
import { CheckCircle2, Loader2, RefreshCw, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

interface AttorneyDraftReviewProps {
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  onRefresh: () => void;
}

export default function AttorneyDraftReview({
  matterId, phaseName, phaseLabel, onRefresh,
}: AttorneyDraftReviewProps) {
  const [feedback, setFeedback] = useState("");
  const [showRevisionInput, setShowRevisionInput] = useState(false);

  const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName });
  const versions = phaseQuery.data?.versions ?? [];

  // Get the latest version (highest version number)
  const latestVersion = versions.length > 0
    ? versions.reduce((a: any, b: any) => (a.versionNumber > b.versionNumber ? a : b))
    : null;

  const provider = latestVersion
    ? PROVIDERS.find(p => p.key === latestVersion.provider)
    : null;

  const requestRevision = trpc.phase.requestRevision.useMutation({
    onSuccess: (data) => {
      toast.success(`Revision v${data.versionNumber} generated`);
      setFeedback("");
      setShowRevisionInput(false);
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const acceptDraft = trpc.phase.acceptDraft.useMutation({
    onSuccess: (data) => {
      toast.success(`Draft accepted (v${data.officialFinalVersion})`);
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
              Review the draft from {provider?.name ?? "AI"} — v{latestVersion?.versionNumber ?? 1}
              {versions.length > 1 && ` (${versions.length} versions)`}
            </CardDescription>
          </div>
          <Badge className="bg-amber-500 text-white">Attorney Review</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {phaseQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !latestVersion ? (
          <p className="text-muted-foreground text-center py-8">No draft available yet.</p>
        ) : (
          <>
            {/* Version History (if multiple) */}
            {versions.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground border-b pb-2">
                <span>Versions:</span>
                {versions
                  .sort((a: any, b: any) => a.versionNumber - b.versionNumber)
                  .map((v: any) => (
                    <Badge
                      key={v.id}
                      variant={v.versionNumber === latestVersion.versionNumber ? "default" : "outline"}
                      className="text-xs"
                    >
                      v{v.versionNumber}
                    </Badge>
                  ))}
              </div>
            )}

            {/* Draft Content */}
            <ScrollArea className="h-[400px] rounded-lg border p-4">
              <div className="prose prose-sm max-w-none">
                <Streamdown>{latestVersion.content}</Streamdown>
              </div>
            </ScrollArea>

            <Separator />

            {/* Revision Input */}
            {showRevisionInput ? (
              <div className="space-y-3">
                <Textarea
                  placeholder="Describe what changes you'd like made to this draft..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => requestRevision.mutate({ matterId, phaseName, feedback })}
                    disabled={!feedback.trim() || requestRevision.isPending}
                  >
                    {requestRevision.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Submit Revision Request
                  </Button>
                  <Button variant="ghost" onClick={() => { setShowRevisionInput(false); setFeedback(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button
                  onClick={() => acceptDraft.mutate({ matterId, phaseName })}
                  disabled={acceptDraft.isPending}
                  className="flex-1"
                  size="lg"
                >
                  {acceptDraft.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Accept Draft
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowRevisionInput(true)}
                  className="flex-1"
                  size="lg"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Request Revision
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
