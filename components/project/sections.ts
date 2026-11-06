import { ChartNoAxesColumn, FlaskConical, KeyRound, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { useSearchParams } from "next/navigation";

export const projectSections = [
  { id: "apiKeys", icon: KeyRound, href: "/" },
  { id: "users", icon: UsersRound, href: "/?section=users" },
  { id: "usage", icon: ChartNoAxesColumn, href: "/?section=usage" },
  { id: "config", icon: Settings2, href: "/?section=config" },
  { id: "projectAdmin", icon: ShieldCheck, href: "/?section=projectAdmin" },
  { id: "playground", icon: FlaskConical, href: "/?section=playground" },
] as const;

export function useProjectSection() {
  const requested = useSearchParams().get("section");
  return projectSections.find((section) => section.id === requested) ?? projectSections[0];
}
