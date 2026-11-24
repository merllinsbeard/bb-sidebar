import { ProviderIcon, type useProviders } from "./bb-sdk";

import { cn } from "./lib/utils";

export type SidebarProvider = ReturnType<typeof useProviders>["providers"][number];

/**
 * The agent a thread runs on, resolved from bb's live provider directory.
 *
 * Leads a thread row (matching bb's native sidebar) or compact/child rows.
 * bb draws a known provider's artwork, with its theme tint. A provider
 * missing from the current directory gets a neutral dot.
 */
export function ProviderGlyph({
  providerId,
  provider,
  className,
}: {
  providerId: string;
  provider: SidebarProvider | null;
  className?: string;
}) {
  const label = provider?.displayName ?? providerId;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] [&_img]:!size-full [&_img]:!max-w-full [&_img]:!max-h-full [&_img]:object-cover [&_svg]:max-h-full [&_svg]:max-w-full",
        className,
      )}
    >
      {provider ? (
        <ProviderIcon
          providerKind="agent"
          provider={provider}
          aria-hidden
          className="size-3.5 text-muted-foreground/70"
        />
      ) : (
        <span className="size-2 rounded-full bg-muted-foreground/50" />
      )}
    </span>
  );
}
