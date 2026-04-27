import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({ className, value = 0, ...props }: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root className={cn("relative h-2 overflow-hidden rounded-full bg-secondary", className)} {...props}>
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform duration-500"
        style={{ transform: `translateX(-${100 - Number(value)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
