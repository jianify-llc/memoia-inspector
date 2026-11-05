import { memoiaBindingOrigin } from "@/lib/memoia-transport";
import ProjectSettingsForm from "./project-settings-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <ProjectSettingsForm boundOrigin={memoiaBindingOrigin()} />;
}
