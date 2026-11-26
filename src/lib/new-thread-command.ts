import type { PluginAppCommands } from "@get-bb/plugin-sdk/app";
import { BROWSER_EVENTS } from "./browser-events";
import { toast } from "./toast";

/**
 * bb's own New thread command preselects the project of the thread in view.
 * This one always starts outside every project. It has no default shortcut:
 * bind Cmd/Ctrl+N to it in Settings → Keyboard (or `bb settings keyboard set
 * plugin:bb-sidebar/new-thread-no-project mod+n`) after clearing bb's binding.
 */
export function registerNewThreadCommand(commands: PluginAppCommands) {
  commands.register({
    id: "new-thread-no-project",
    title: "BB Sidebar: New thread without a project",
    run: () => {
      // The mounted inbox owns navigation; an unhandled event means it is not mounted.
      const event = new CustomEvent(BROWSER_EVENTS.newThreadCommand, { cancelable: true });
      if (window.dispatchEvent(event)) toast.error("Open the BB Sidebar to start a thread");
    },
  });
}
