import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { PROVIDERS } from "@shared/workflow";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

interface DraftComparisonProps {
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  onRefresh: () => void;
}

export default function DraftComparison({ matterId, phaseName, phaseLabel, onRefresh }: DraftComparisonProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // phase.get returns { phase, versions, feedback }
  const phaseQuery = trpc.phase.get.useQuery({ matterId, phaseName });

  const selectDraft = trpc.phase.selectDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft selected — starting review cycle");
      onRefresh();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const enabledProviders = PROVIDERS.filter(p => p.enabled);
  const versions = phaseQuery.data?.versions ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-serif text-xl">{phaseLabel}</CardTitle>
            <CardDescription className="mt-1">
              Compare drafts from {enabledProviders.length} providers and select the best one
            </CardDescription>
          </div>
          <Badge className="bg-amber-500 text-white">Select Draft</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {phaseQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No drafts available yet.</p>
        ) : (
          <div className="space-y-4">
            <Tabs defaultValue={versions[0]?.provider ?? ""} className="w-full">
              <TabsList className="w-full justify-start">
                {versions.map((v: any) => {
                  const provider = PROVIDERS.find(p => p.key === v.provider);
                  return (
                    <TabsTrigger key={v.provider} value={v.provider} className="gap-2">
                      {provider?.name ?? v.provider}
                      {selectedProvider === v.provider && (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {versions.map((v: any) => (
                <TabsContent key={v.provider} value={v.provider}>
                  <div className="space-y-3">
                    <ScrollArea className="h-[400px] rounded-lg border p-4">
                      <div className="prose prose-sm max-w-none">
                        <Streamdown>{v.content}</Streamdown>
                      </div>
                    </ScrollArea>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Version {v.versionNumber} &middot; {v.provider}
                      </p>
                      <Button
                        onClick={() => {
                          setSelectedProvider(v.provider);
                          selectDraft.mutate({
                            matterId,
                            phaseName,
                            versionId: v.id,
                          });
                        }}
                        disabled={selectDraft.isPending}
                      >
                        {selectDraft.isPending && selectedProvider === v.provider ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                        )}
                        Select This Draft
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
