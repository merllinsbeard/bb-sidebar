// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { PluginCommandContext, PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "./test-slot";
import { inbox, thread, listProps, toastMocks, loadInboxApp } from "./test-inbox";
import { registerNewThreadCommand } from "./lib/new-thread-command";

vi.mock("sonner", async () => (await import("./test-inbox")).sonnerMock());

await loadInboxApp();

function runCommand() {
  let command: PluginCommandRegistration | undefined;
  registerNewThreadCommand({ register: (registration) => (command = registration) });
  return command!.run({ threadId: "thr_1", projectId: "proj_1" } as PluginCommandContext);
}

describe("new thread without a project command", () => {
  it("opens New thread with the personal project while a project thread is in view", async () => {
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_1", projectId: "proj_1" })],
        projects: [
          { id: "proj_1", name: "bb", isPersonal: false, href: "", settingsHref: "" },
          { id: "proj_personal", name: "Personal", isPersonal: true, href: "/", settingsHref: "" },
        ],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
    });

    await runCommand();

    await waitFor(() =>
      expect(rendered.navigateCalls).toContainEqual({
        method: "toCompose",
        options: { projectId: "proj_personal", focusPrompt: true },
      }),
    );
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("says so when no sidebar is mounted to open the screen", async () => {
    await runCommand();
    expect(toastMocks.error).toHaveBeenCalledWith("Open the BB Sidebar to start a thread", expect.anything());
  });
});
