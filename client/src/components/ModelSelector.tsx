import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ENABLED_PROVIDERS, PHASE_CONFIG, type PhaseName } from "@shared/workflow";
import { Loader2, Cpu } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ModelSelectorProps {
  matterId: string;
  phaseName: string;
  phaseLabel: string;
  sourceContent?: string;
  context?: string;
  onRefresh: () => void;
}

export default function ModelSelector({
  matterId, phaseName, phaseLabel, sourceContent, context, onRefresh,
}: ModelSelectorProps) {
  const [selectedModel, setSelectedModel] = useState<string>(ENABLED_PROVIDERS[0]?.key ?? "");

  const config = PHASE_CONFIG[phaseName as PhaseName];
  const modeLabel = config?.defaultMode === "single_model"
    ? "Single Model Processing"
    : "Simple Draft";

  const selectModel = trpc.phase.selectModel.useMutation({
    onSuccess: (data) => {
      if (data.workflowState === "complete") {
        toast.success("Phase completed successfully");
      } else {
        toast.success("Model selected — drafting started");
      }
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
              {modeLabel} — Select which AI model to use
            </CardDescription>
          </div>
          <Badge className="bg-blue-500 text-white">
            <Cpu className="h-3 w-3 mr-1" /> Select Model
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup
          value={selectedModel}
          onValueChange={setSelectedModel}
          className="space-y-3"
        >
          {ENABLED_PROVIDERS.map((provider) => (
            <div
              key={provider.key}
              className={`flex items-center space-x-3 rounded-lg border p-4 transition-colors cursor-pointer
                ${selectedModel === provider.key ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
              onClick={() => setSelectedModel(provider.key)}
            >
              <RadioGroupItem value={provider.key} id={`model-${provider.key}`} />
              <Label htmlFor={`model-${provider.key}`} className="flex-1 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{provider.model}</p>
                  </div>
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>

        <Button
          onClick={() => selectModel.mutate({
            matterId,
            phaseName,
            modelId: selectedModel,
            sourceContent,
            context,
          })}
          disabled={!selectedModel || selectModel.isPending}
          className="w-full"
          size="lg"
        >
          {selectModel.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Cpu className="h-4 w-4 mr-2" />
          )}
          Start with {ENABLED_PROVIDERS.find(p => p.key === selectedModel)?.name ?? "Selected Model"}
        </Button>
      </CardContent>
    </Card>
  );
}
