"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight } from "lucide-react";

import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { clearLocale } from "@/utils/memoia/client";

export function ProjectSwitch() {
  const router = useRouter();
  const t = useTranslations("navigation");
  const { setOpenMobile } = useSidebar();
  const title = t("switch_project");

  return (
    <SidebarMenuButton
      type="button"
      tooltip={title}
      onClick={async () => {
        await clearLocale();
        setOpenMobile(false);
        router.push("/settings");
      }}
    >
      <ArrowLeftRight />
      <span>{title}</span>
    </SidebarMenuButton>
  );
}
