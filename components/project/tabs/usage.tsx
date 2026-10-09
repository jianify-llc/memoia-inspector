"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { GetProjectUsageItemResponse } from "@/api/models/memobase";
import { getProjectUsage } from "@/api/models/memobase";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

import { Project } from "@/types";

const chartConfig = {
  tokens: {
    label: "Token Usage 7d",
    config: {
      left: {
        label: "Input",
        color: "hsl(var(--chart-1))",
      },
      right: {
        label: "Output",
        color: "hsl(var(--chart-2))",
      },
    },
  },
  insert: {
    label: "Insert Requests 7d",
    config: {
      left: {
        label: "Request",
        color: "hsl(var(--chart-1))",
      },
      right: {
        label: "Success",
        color: "hsl(var(--chart-2))",
      },
    },
  },
};

export default function Usage({ project }: { project: Project }) {
  const router = useRouter();
  const t = useTranslations("project");
  // The identity stays local; never render or log the project credential.
  const owner = `${project.endpoint_url}\0${project.endpoint_token}`;
  const [result, setResult] = useState<
    | { owner: string; status: "loading" }
    | { owner: string; status: "error" }
    | { owner: string; status: "ready"; usage: GetProjectUsageItemResponse[] }
  >({ owner, status: "loading" });
  const [retry, setRetry] = useState(0);

  const [activeChart, setActiveChart] =
    useState<keyof typeof chartConfig>("tokens");

  useEffect(() => {
    const controller = new AbortController();
    setResult({ owner, status: "loading" });
    const load = async () => {
      try {
        const res = await getProjectUsage(7, controller.signal);
        if (controller.signal.aborted) return;
        if (res.code === 401) router.push("/login");
        if (res.code === 0 && res.data?.usages) {
          setResult({ owner, status: "ready", usage: res.data.usages });
          return;
        }
        toast.error(res.message || t("usage.unavailable"));
      } catch {
        if (controller.signal.aborted) return;
        toast.error(t("usage.unavailable"));
      }
      setResult({ owner, status: "error" });
    };
    void load();
    return () => controller.abort();
  }, [owner, retry, router, t]);

  if (result.owner !== owner || result.status === "loading") {
    return <Skeleton className="h-[60dvh] w-full" />;
  }
  if (result.status === "error") {
    return <Card><CardContent className="space-y-2 pt-6">
      <p role="alert">{t("usage.unavailable")}</p>
      <button onClick={() => setRetry((count) => count + 1)}>{t("retry")}</button>
    </CardContent></Card>;
  }
  const usage = result.usage;
  const incomplete = usage.some((day) => day.usage_complete === false);
  const total = {
    tokens: usage.reduce((sum, day) => sum + day.total_input_token + day.total_output_token, 0),
    insert: usage.reduce((sum, day) => sum + day.total_success_insert, 0),
  };

  return (
    <>
        <Card className="!py-0">
          {incomplete && <p role="status" className="px-6 py-3 text-sm text-muted-foreground">{t("usage.incomplete")}</p>}
          <CardHeader className="flex flex-col items-stretch space-y-0 border-b !p-0 sm:flex-row">
            <div className="flex">
              {["tokens", "insert"].map((key) => {
                const chart = key as keyof typeof chartConfig;
                return (
                  <button
                    key={chart}
                    data-active={activeChart === chart}
                    className="min-w-44 relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-8 sm:py-6"
                    onClick={() => setActiveChart(chart)}
                  >
                    <span className="text-xs text-muted-foreground">
                      {chartConfig[chart].label}
                    </span>
                    <span className="text-lg font-bold leading-none sm:text-3xl">
                      {total[key as keyof typeof total].toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardHeader>
          <CardContent className="">
            <ChartContainer
              config={chartConfig[activeChart].config}
              className="mx-auto max-h-[calc(100dvh-31rem)]"
            >
              <BarChart
                accessibilityLayer
                data={
                  activeChart === "tokens"
                    ? usage?.map((item) => ({
                        x: item.date,
                        left: item.total_input_token,
                        right: item.total_output_token,
                      }))
                    : usage?.map((item) => ({
                        x: item.date,
                        left: item.total_insert,
                        right: item.total_success_insert,
                      }))
                }
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="x"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent indicator="dashed" />}
                />
                <Bar dataKey="left" fill="var(--color-left)" radius={4} />
                <Bar dataKey="right" fill="var(--color-right)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
    </>
  );
}
