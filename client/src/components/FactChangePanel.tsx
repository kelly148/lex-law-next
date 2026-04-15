import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { PHASE_LABELS, type PhaseName } from "@shared/workflow";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Phase {
  id: number;
  phaseName: string;
  workflowState: string;
}

interface FactChangePanelProps {
  matterId: string;
  phases: Phase[];
  onClose: () => void;
  onCreated: () => void;
}

export default function FactChangePanel({ matterId, phases, onClose, onCreated }: FactChangePanelProps) {
  const [description, setDescription] = useState("");
  const [selectedPhases, setSelectedPhases] = useState<string[]>([]);

  const createFactChange = trpc.factChange.create.useMutation({
    onSuccess: () => {
      toast.success("Fact change recorded — affected phases marked stale");
      onCreated();
    },
    onError: (err) => toast.error(err.message),
  });

  const togglePhase = (phaseName: string) => {
    setSelectedPhases(prev =>
      prev.includes(phaseName)
        ? prev.filter(p => p !== phaseName)
        : [...prev, phaseName]
    );
  };

  return (
    <Card className="border-amber-300 bg-amber-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
            Record Fact Change
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            placeholder="Describe the fact change (e.g., 'Client ownership percentage changed from 50% to 60%')"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label>Affected Phases</Label>
          <p className="text-xs text-muted-foreground">All downstream phases will also be marked stale</p>
          <div className="grid grid-cols-2 gap-2">
            {phases.map(phase => {
              const phaseName = phase.phaseName as PhaseName;
              return (
                <div key={phaseName} className="flex items-center gap-2">
                  <Checkbox
                    id={`fc-${phaseName}`}
                    checked={selectedPhases.includes(phaseName)}
                    onCheckedChange={() => togglePhase(phaseName)}
                  />
                  <Label htmlFor={`fc-${phaseName}`} className="text-sm cursor-pointer">
                    {PHASE_LABELS[phaseName] ?? phaseName}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          onClick={() => {
            if (!description.trim()) { toast.error("Description is required"); return; }
            if (selectedPhases.length === 0) { toast.error("Select at least one affected phase"); return; }
            createFactChange.mutate({ matterId, description: description.trim(), affectedPhases: selectedPhases });
          }}
          disabled={createFactChange.isPending}
          className="w-full"
        >
          {createFactChange.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
          Record Fact Change
        </Button>
      </CardContent>
    </Card>
  );
}
