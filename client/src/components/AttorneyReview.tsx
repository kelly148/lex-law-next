import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { Check, X, Pencil, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface AttorneyReviewProps {
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  onRefresh: () => void;
}

type Decision = "accepted" | "rejected" | "modified";

interface FeedbackDecision {
  feedbackId: number;
  decision: Decision;
  modification?: string;
}

export default function AttorneyReview({ matterId, phaseName, phaseLabel, onRefresh }: AttorneyReviewProps) {
  const [decisions, setDecisions] = useState<Map<number, FeedbackDecision>>(new Map());
  const [modifications, setModifications] = useState<Map<number, string>>(new Map());
  const [additions, setAdditions] = useState("");

  const feedbackQuery = trpc.feedback.list.useQuery({ matterId, phaseName });
  const submitDecisions = trpc.phase.submitDecisions.useMutation({
    onSuccess: () => {
      toast.success("Decisions submitted — regenerating draft");
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const feedbackItems = feedbackQuery.data ?? [];
  const totalItems = feedbackItems.length;
  const decidedCount = decisions.size;
  const allDecided = decidedCount === totalItems && totalItems > 0;

  const setDecision = (id: number, decision: Decision) => {
    setDecisions(prev => {
      const next = new Map(prev);
      next.set(id, { feedbackId: id, decision, modification: modifications.get(id) });
      return next;
    });
  };

  const handleSubmit = () => {
    const decisionList = Array.from(decisions.values()).map(d => ({
      feedbackId: d.feedbackId,
      decision: d.decision,
      attorneyNote: d.decision === "modified" ? modifications.get(d.feedbackId) : undefined,
    }));
    submitDecisions.mutate({
      matterId,
      phaseName,
      decisions: decisionList,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-serif text-xl">{phaseLabel}</CardTitle>
            <CardDescription className="mt-1">
              Review feedback from independent reviewers — {decidedCount}/{totalItems} decided
            </CardDescription>
          </div>
          <Badge className="bg-amber-500 text-white">Review Feedback</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {feedbackQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : feedbackItems.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No feedback items available.</p>
        ) : (
          <div className="space-y-6">
            {/* Decision Summary Bar */}
            <div className="flex items-center gap-4 rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-sm">{Array.from(decisions.values()).filter(d => d.decision === "accepted").length} Accept</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-sm">{Array.from(decisions.values()).filter(d => d.decision === "rejected").length} Reject</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <span className="text-sm">{Array.from(decisions.values()).filter(d => d.decision === "modified").length} Modify</span>
              </div>
              <div className="flex-1" />
              <span className="text-sm text-muted-foreground">{decidedCount}/{totalItems}</span>
            </div>

            {/* Feedback Items */}
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-3">
                {feedbackItems.map((item: any) => {
                  const currentDecision = decisions.get(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        currentDecision?.decision === "accepted" ? "border-green-300 bg-green-50/50" :
                        currentDecision?.decision === "rejected" ? "border-red-300 bg-red-50/50" :
                        currentDecision?.decision === "modified" ? "border-blue-300 bg-blue-50/50" :
                        ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">{item.reviewerProvider ?? "Reviewer"}</Badge>
                            <Badge variant="secondary" className="text-xs">{item.category ?? "General"}</Badge>
                          </div>
                          <p className="text-sm mt-1">{item.point}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant={currentDecision?.decision === "accepted" ? "default" : "outline"}
                            className={currentDecision?.decision === "accepted" ? "bg-green-600 hover:bg-green-700" : ""}
                            onClick={() => setDecision(item.id, "accepted")}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={currentDecision?.decision === "rejected" ? "default" : "outline"}
                            className={currentDecision?.decision === "rejected" ? "bg-red-600 hover:bg-red-700" : ""}
                            onClick={() => setDecision(item.id, "rejected")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={currentDecision?.decision === "modified" ? "default" : "outline"}
                            className={currentDecision?.decision === "modified" ? "bg-blue-600 hover:bg-blue-700" : ""}
                            onClick={() => setDecision(item.id, "modified")}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {currentDecision?.decision === "modified" && (
                        <div className="mt-3">
                          <Textarea
                            placeholder="Describe how this should be modified..."
                            value={modifications.get(item.id) ?? ""}
                            onChange={(e) => {
                              setModifications(prev => {
                                const next = new Map(prev);
                                next.set(item.id, e.target.value);
                                return next;
                              });
                            }}
                            rows={2}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <Separator />

            {/* Attorney Additions */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Attorney Additions (optional)</label>
              <Textarea
                placeholder="Add any additional instructions or requirements for the regenerated draft..."
                value={additions}
                onChange={(e) => setAdditions(e.target.value)}
                rows={3}
              />
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={!allDecided || submitDecisions.isPending}
              className="w-full"
              size="lg"
            >
              {submitDecisions.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Submit Decisions & Regenerate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
