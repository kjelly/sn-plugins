import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAndroidBuildToolsVersion, resolveAppiumEndpoint } from "./appium-endpoint.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const apkPath = path.join(rootDir, "artifacts/standardnotes.apk");
export const appiumEndpoint = resolveAppiumEndpoint(process.env.APPIUM_PORT);

export const config = {
  runner: "local",
  ...appiumEndpoint,
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: path.join(rootDir, "tsconfig.json"),
      transpileOnly: true,
    },
  },
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:deviceName": process.env.ANDROID_DEVICE_NAME || "Android Emulator",
      "appium:app": apkPath,
      "appium:appPackage": "com.standardnotes",
      "appium:appActivity": "com.standardnotes.MainActivity",
      "appium:noReset": true,
      "appium:fullReset": false,
      "appium:autoGrantPermissions": false,
      "appium:buildToolsVersion": resolveAndroidBuildToolsVersion(process.env.ANDROID_BUILD_TOOLS_VERSION),
      "appium:newCommandTimeout": 240,
    },
  ],
  logLevel: "info",
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 300000,
  },
};
