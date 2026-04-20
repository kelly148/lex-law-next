/**
 * ModelPicker.tsx
 *
 * Reusable model dropdown per v2.3 §16.7.
 *
 * Context-dependent defaults:
 *   - "idle"        → Claude (first enabled provider)
 *   - "evaluator"   → currentVersionModel
 *   - "regenerator" → currentVersionModel
 *   - "restart"     → (no default — forces explicit choice)
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ENABLED_PROVIDERS } from "@shared/workflow";
import type { ProviderKey } from "@shared/workflow";

export type ModelPickerContext = "idle" | "evaluator" | "regenerator" | "restart";

export interface ModelPickerProps {
  /** Which usage context — controls default selection per §16.7 */
  context: ModelPickerContext;
  /** The model key of the current version (used for evaluator/regenerator defaults) */
  currentVersionModel?: ProviderKey;
  /** Currently selected model key */
  value: ProviderKey | "";
  /** Called when the user changes selection */
  onChange: (value: ProviderKey) => void;
  /** Optional label shown above the select */
  label?: string;
  /** Disable the picker (e.g. while a mutation is in flight) */
  disabled?: boolean;
}

/**
 * Returns the default model key for the given context.
 * "restart" context intentionally returns "" (no default).
 */
export function getDefaultModel(
  context: ModelPickerContext,
  currentVersionModel?: ProviderKey,
): ProviderKey | "" {
  switch (context) {
    case "idle":
      // Default to Claude per §16.7
      return (ENABLED_PROVIDERS.find((p) => p.key === "claude")?.key ??
        ENABLED_PROVIDERS[0]?.key ??
        "") as ProviderKey | "";
    case "evaluator":
    case "regenerator":
      return currentVersionModel ?? "";
    case "restart":
      // No default — attorney must make an explicit choice
      return "";
  }
}

export default function ModelPicker({
  context,
  currentVersionModel,
  value,
  onChange,
  label,
  disabled = false,
}: ModelPickerProps) {
  const placeholder =
    context === "restart"
      ? "Select a model…"
      : "Select a model…";

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label className="text-sm font-medium text-foreground">{label}</Label>
      )}
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ProviderKey)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[200px]" data-testid="model-picker-trigger">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {ENABLED_PROVIDERS.map((provider) => (
            <SelectItem
              key={provider.key}
              value={provider.key}
              data-testid={`model-option-${provider.key}`}
            >
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
