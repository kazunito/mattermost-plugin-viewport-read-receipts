import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'tests',testMatch:'*.spec.ts',fullyParallel:false,workers:1,timeout:20000,
 reporter:[['list'],['json',{outputFile:'work/browser-tests.json'}]],
 use:{baseURL:'http://127.0.0.1:4178',viewport:{width:1200,height:800},launchOptions:{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},trace:'retain-on-failure'},
 webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:4178',reuseExistingServer:false,timeout:20000},
});
