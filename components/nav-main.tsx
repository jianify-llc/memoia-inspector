"use client";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { projectSections, useProjectSection } from "@/components/project/sections";

export function NavMain() {
  const pathname = usePathname();
  const section = useProjectSection();
  const t = useTranslations();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup role="navigation" aria-label={t("navigation.project")}>
      <SidebarGroupLabel>{t("navigation.project")}</SidebarGroupLabel>
      <SidebarMenu>
        {projectSections.map((item) => {
          const active = pathname === "/" && section.id === item.id;
          const title = t(`project.tabs.${item.id}`);
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton asChild isActive={active} tooltip={title}>
                <Link href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>
                  <item.icon />
                  <span>{title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
