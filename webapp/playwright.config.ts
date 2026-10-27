import {defineConfig} from '@playwright/test';

// By default use Playwright's downloaded Chromium on every supported OS.
// A local browser can optionally be selected without a machine-specific default.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
    testDir: 'tests',
    testMatch: '*.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 20000,
    globalTimeout: 180000,
    reporter: [['list'], ['json', {outputFile: '../work/browser-tests.json'}]],
    use: {
        baseURL: 'http://127.0.0.1:4178',
        viewport: {width: 1200, height: 800},
        ...(executablePath ? {launchOptions: {executablePath}} : {channel: 'chromium'}),
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'node test-server.mjs',
        url: 'http://127.0.0.1:4178',
        reuseExistingServer: false,
        timeout: 20000,
    },
});
