import { useState, useEffect } from "react";
import { ChevronDown, Settings2, Smartphone } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  isPhoneBypassEnabled,
  setPhoneBypassEnabled,
  subscribeDevSettings,
} from "@/lib/devSettings";

export function DeveloperSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const [phoneBypass, setPhoneBypass] = useState(isPhoneBypassEnabled);

  useEffect(() => {
    return subscribeDevSettings(() => setPhoneBypass(isPhoneBypassEnabled()));
  }, []);

  return (
    <div className="w-full border-b border-amber-500/30 bg-amber-50/90 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-9 text-amber-900 hover:bg-amber-100/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <Settings2 className="h-3.5 w-3.5" />
          Developer Settings
        </span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/20 bg-white/70 px-4 py-3">
            <div className="flex items-start gap-3 min-w-0">
              <Smartphone className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <Label htmlFor="phone-bypass" className="text-sm font-medium text-amber-950 cursor-pointer">
                  Phone Number Bypass
                </Label>
                <p className="text-xs text-amber-800/70 mt-0.5">
                  SMS დადასტურების გარეშე გაგრძელება (ბოლო ეტაპზე)
                </p>
              </div>
            </div>
            <Switch
              id="phone-bypass"
              checked={phoneBypass}
              onCheckedChange={(checked) => {
                setPhoneBypassEnabled(checked);
                setPhoneBypass(checked);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
