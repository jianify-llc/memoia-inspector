import { memoiaConnection } from "@/lib/memoia-transport";
import ProjectSettingsForm from "./project-settings-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const { managed, binding, defaultUrl } = memoiaConnection();
  return <ProjectSettingsForm managed={managed} hasWorker={Boolean(binding)} defaultUrl={defaultUrl} />;
}
