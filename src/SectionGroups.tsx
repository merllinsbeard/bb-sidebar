import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { InboxThreadOptions } from "./InboxThreadRenderer";
import { GroupAlertDots, groupAlertPhrase } from "./GroupAlertDots";
import { useInboxEnvironment } from "./InboxContext";
import type { SectionGroupView } from "./section-groups";
import { HeaderChevron } from "./ThreadInboxShelves";
import { useListMotion } from "./useListMotion";

function ActiveSectionGroup({
  group,
  onToggle,
  children,
}: {
  group: SectionGroupView;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { sectionColorById } = useInboxEnvironment();
  const attachListMotionRef = useListMotion<HTMLUListElement>();
  const colorStyle = group.isUnsorted ? undefined : sectionColorById.get(group.id);
  return (
    <li className="list-none">
      <section aria-label={`${group.name} section`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={group.expanded}
          aria-label={`${group.name} (${group.threadCount})${groupAlertPhrase(group.alerts)}`}
          style={colorStyle}
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-normal leading-5 text-subtle-foreground/75 transition-colors hover:text-sidebar-foreground"
        >
          {!group.isUnsorted ? (
            <span aria-hidden="true" className="bb-sidebar-section-dot size-1.5 shrink-0 rounded-full" />
          ) : null}
          <span className="min-w-0 truncate">{group.name}</span>
          <span className="shrink-0 text-xs font-normal tabular-nums text-subtle-foreground/55">
            {group.threadCount}
          </span>
          <GroupAlertDots alerts={group.alerts} />
          <span className="flex-1" />
          <HeaderChevron expanded={group.expanded} className="text-subtle-foreground" />
        </button>
        {group.threads.length > 0 ? (
          <ul ref={attachListMotionRef} aria-label={`${group.name} active threads`} className="flex flex-col gap-px">
            {children}
          </ul>
        ) : null}
      </section>
    </li>
  );
}

/** Native-style collapsible section groups under the Active shelf. */
export function SectionGroups({
  groups,
  onToggle,
  renderThread,
}: {
  groups: readonly SectionGroupView[];
  onToggle: (sectionId: string) => void;
  renderThread: (thread: PluginSidebarThread, options?: InboxThreadOptions) => React.ReactNode;
}) {
  const attachListMotionRef = useListMotion<HTMLUListElement>();
  if (groups.length === 0) return null;
  return (
    <ul ref={attachListMotionRef} className="flex flex-col gap-px">
      {groups.map((group) => (
        <ActiveSectionGroup key={group.id} group={group} onToggle={() => onToggle(group.id)}>
          {group.threads.map((thread) =>
            renderThread(thread, { showSection: false, showChildAttention: group.expanded }),
          )}
        </ActiveSectionGroup>
      ))}
    </ul>
  );
}
