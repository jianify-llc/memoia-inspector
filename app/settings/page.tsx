import { redirect } from "next/navigation";
import { hasManagedProject } from "@/utils/memoia/project-credentials";
import { memoiaConnection } from "@/lib/memoia-transport";
import ProjectSettingsForm from "./project-settings-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  if (hasManagedProject()) redirect("/");
  const { managed, binding, defaultUrl } = memoiaConnection();
  return <ProjectSettingsForm managed={managed} hasWorker={Boolean(binding)} defaultUrl={defaultUrl} />;
}
