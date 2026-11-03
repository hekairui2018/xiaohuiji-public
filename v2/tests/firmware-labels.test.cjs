'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {describe}=require('../frontend/firmware-labels.js');
test('receiver labels use card-specific common codes and literal known family variants',()=>{
 assert.equal(describe('R712_FPGA_V25.13.01.30.bin').label,'通用固件');
 assert.equal(describe('R708_FPGA_V25.01.02.32.bin').label,'通用固件');
 assert.notEqual(describe('R708_FPGA_V25.01.01.32.bin').label,'通用固件');
 assert.equal(describe('R712_FPGA_V25.07.97.30_E1.bin').label,'LS9937 系列 · E1');
 assert.equal(describe('R712_FPGA_V25.26.65.30.bin').label,'ICN2065 系列');
 assert.equal(describe('R712_FPGA_V25.03.72.30.bin').label,'专用固件 · 72 系列');
 assert.match(describe('R712_FPGA_V25.01.84.30.bin').label,/用途待核对/);
 assert.equal(describe('C16L_FPGA_V9.16.13.0.bin').label,'通用固件');
 assert.equal(describe('unknown.bin'),null);
});

test('current approved firmware inventory has display labels without treating labels as compatibility',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/catalog/generated/curated-local-firmware.json'),'utf8')).items;
 for(const row of rows)assert(describe(row.name,row)?.label,row.name);
});

test('backend and browser labels share the identical reviewed mapping implementation',()=>{
 const fs=require('node:fs'),path=require('node:path');
 assert.equal(fs.readFileSync(path.join(__dirname,'../frontend/firmware-labels.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../domain/knowledge/firmware-labels.cjs'),'utf8'));
});

test('receiver compound FPGA and MCU names retain family and hardware variant',()=>{
 assert.equal(describe('R716_R732_FPGA_V25.11.01.31_MCU_V24.00.15.11.bin').label,'通用固件');
 assert.equal(describe('R716_R732_FPGA_V25.11.99.31_E0_MCU_V24.00.08.11.bin').label,'LS99 系列 · E0');
 assert.equal(describe('R716_R732_FPGA_V25.07.97.31_E1_MCU_V24.00.08.11.bin').label,'LS9937 系列 · E1');
});

test('asynchronous codes use their own model-specific mappings and accept registered filename forms',()=>{
 assert.equal(describe('D16_FPGA_V9_3_78_71.bin').family,'65');
 assert.equal(describe('C08L_FPGA_9_8_18_71.bin').family,'65');
 assert.equal(describe('FPGA_C16_C36_9_6_24_73.bin').family,'63');
 assert.equal(describe('C16L_FPGA_V9_16_16_99.bin').family,'99');
 assert.equal(describe('C16H_FPGA_V9_17_18_00.bin').confirmed,false);
 assert.equal(describe('C16H_FPGA_V9_17.18.65.bin').deliveryVerified,false);
 assert.equal(describe('FPFA_D16_V9_3_26_73.bin',{models:['HD-D16'],versionNote:'HDPlayer 在线版本 Dx6_FPGA_V9_3_26_73'}).family,'63');
 assert.equal(describe('FPFA_D16_V9_3_26_73.bin'),null);
});
