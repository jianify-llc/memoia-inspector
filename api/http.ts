/* eslint-disable @typescript-eslint/no-explicit-any */
import { ofetch } from "ofetch";
import { ApiResponse } from "@/lib/api-response";

type Method =
  | "GET"
  | "HEAD"
  | "PATCH"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS";

const request = async <T = any>(
  method: Method,
  url: string,
  data: {
    params?: Record<string, any>;
    body?: Record<string, any>;
    headers?: HeadersInit;
    signal?: AbortSignal;
  }
): Promise<T> => {
  return await ofetch<T>(url, {
    method,
    baseURL: process.env["NEXT_PUBLIC_BASE_PATH"] || "",
    params: data.params,
    headers: data.headers,
    signal: data.signal,
    credentials: "include",
    body: data.body,
    // API failures carry the existing { code, message } contract for the UI.
    ignoreResponseError: true,
    timeout: 10_000,
    // 写请求的未知结果由调用方读取核对，不能由 ofetch 自动重发。
    retry: 0,
  });
};

const service = {
  async get<T = any>(
    url: string,
    data?: Record<string, any>,
    headers?: HeadersInit,
    signal?: AbortSignal
  ): Promise<T> {
    return await request("GET", url, { params: data, headers, signal });
  },

  async post<T = any>(url: string, data?: Record<string, any>): Promise<T> {
    return await request("POST", url, { body: data });
  },

  async put<T = any>(url: string, data?: Record<string, any>): Promise<T> {
    return await request("PUT", url, { body: data });
  },

  async patch<T = any>(url: string, data?: Record<string, any>): Promise<T> {
    return await request("PATCH", url, { body: data });
  },

  async delete<T = any>(url: string, data?: object): Promise<T> {
    return await request("DELETE", url, { params: data });
  },
};

export default service;

export type Res<T> = ApiResponse<T>;
