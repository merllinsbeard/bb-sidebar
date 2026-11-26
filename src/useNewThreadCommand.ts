import { useEffect } from "react";
import { useBbNavigate, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { BROWSER_EVENTS } from "./lib/browser-events";

/** Open the New thread screen with "Don't work in a project" selected. */
export function useNewThreadCommand(projects: readonly PluginSidebarProject[]) {
  const navigate = useBbNavigate();
  // bb's personal project is how the composer spells "Don't work in a project".
  const personalProjectId = projects.find((project) => project.isPersonal)?.id;
  useEffect(() => {
    const onRequest = (event: Event) => {
      event.preventDefault();
      navigate.toCompose({ projectId: personalProjectId, focusPrompt: true });
    };
    window.addEventListener(BROWSER_EVENTS.newThreadCommand, onRequest);
    return () => window.removeEventListener(BROWSER_EVENTS.newThreadCommand, onRequest);
  }, [navigate, personalProjectId]);
}
