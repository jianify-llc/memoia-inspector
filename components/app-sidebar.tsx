"use client";

import { Suspense, type ComponentProps } from "react";
import { ArrowUpRight, BookText, Github } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/nav-main";
import { ProjectSwitch } from "@/components/project-switch";

import Image from "next/image";
import Link from "next/link";

const resources = [
  { label: "github", href: "https://github.com/jianify-llc/memoia-inspector", icon: Github },
  { label: "docs", href: "https://github.com/jianify-llc/memoia/blob/main/docs/api.md", icon: BookText },
] as const;

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const t = useTranslations("navigation");

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <Image
                  className="rounded"
                  src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/logo.png`}
                  alt="Memoia logo"
                  width={38}
                  height={38}
                  priority
                />
                <span className="font-semibold">Memoia</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <Suspense fallback={null}>
          <NavMain />
        </Suspense>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem><ProjectSwitch /></SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <SidebarMenu>
          {resources.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton asChild tooltip={t(item.label)}>
                <Link href={item.href} target="_blank" rel="noreferrer">
                  <item.icon />
                  <span>{t(item.label)}</span>
                  <ArrowUpRight className="ml-auto opacity-50 group-data-[collapsible=icon]:hidden" />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
