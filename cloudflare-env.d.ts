/* eslint-disable */
// Generic Worker environment; deployments provide their own Memoia binding.
interface __BaseEnv_CloudflareEnv {
	ASSETS: Fetcher;
	MEMOIA?: Fetcher;
}
declare namespace Cloudflare {
	interface Env extends __BaseEnv_CloudflareEnv {}
}
interface CloudflareEnv extends __BaseEnv_CloudflareEnv {}
declare module "*.txt" {
	const value: string;
	export default value;
}
declare module "*.html" {
	const value: string;
	export default value;
}
declare module "*.sql" {
	const value: string;
	export default value;
}
declare module "*.bin" {
	const value: ArrayBuffer;
	export default value;
}
declare module "*.wasm" {
	const value: WebAssembly.Module;
	export default value;
}
declare module "*.wasm?module" {
	const value: WebAssembly.Module;
	export default value;
}
