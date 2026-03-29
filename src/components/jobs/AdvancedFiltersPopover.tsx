import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

export interface AdvancedFilterValues {
  hideSwedishRequired: boolean;
  hideCitizenshipRestricted: boolean;
  hideThreePlusYears: boolean;
}

interface AdvancedFiltersPopoverProps {
  values: AdvancedFilterValues;
  onChange: (values: AdvancedFilterValues) => void;
}

export function AdvancedFiltersPopover({ values, onChange }: AdvancedFiltersPopoverProps) {
  const relaxedCount = Object.values(values).filter((flag) => !flag).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Open advanced filters"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Advanced filters
          {relaxedCount > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] font-medium">
              {relaxedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Suppression rules</h3>
          <p className="text-xs text-muted-foreground/80">
            These controls remove roles that violate your constraints.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="hide-swedish-required" className="cursor-pointer text-xs">
              Hide Swedish-required
            </Label>
            <Switch
              id="hide-swedish-required"
              checked={values.hideSwedishRequired}
              onCheckedChange={(checked) =>
                onChange({
                  ...values,
                  hideSwedishRequired: checked,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="hide-citizenship-restricted" className="cursor-pointer text-xs">
              Hide citizenship-restricted
            </Label>
            <Switch
              id="hide-citizenship-restricted"
              checked={values.hideCitizenshipRestricted}
              onCheckedChange={(checked) =>
                onChange({
                  ...values,
                  hideCitizenshipRestricted: checked,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="hide-three-plus-years" className="cursor-pointer text-xs">
              Hide 3+ years (strict)
            </Label>
            <Switch
              id="hide-three-plus-years"
              checked={values.hideThreePlusYears}
              onCheckedChange={(checked) =>
                onChange({
                  ...values,
                  hideThreePlusYears: checked,
                })
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
