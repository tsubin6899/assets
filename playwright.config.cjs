const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests/mobile',timeout:30000,use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium'},webServer:{command:'node tests/mobile/server.cjs',url:'http://127.0.0.1:4173',reuseExistingServer:false},reporter:'list'});
