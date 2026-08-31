export const DEFAULT_APPIUM_PORT = 4723;
export const DEFAULT_ANDROID_BUILD_TOOLS_VERSION = "35.0.0";

export type AppiumEndpoint = {
  protocol: "http";
  hostname: "127.0.0.1";
  port: number;
  path: "/";
};

export function resolveAppiumEndpoint(rawPort?: string): AppiumEndpoint {
  return {
    protocol: "http",
    hostname: "127.0.0.1",
    port: Number.parseInt(rawPort || String(DEFAULT_APPIUM_PORT), 10),
    path: "/",
  };
}

export function resolveAndroidBuildToolsVersion(rawVersion?: string): string {
  return rawVersion || DEFAULT_ANDROID_BUILD_TOOLS_VERSION;
}
