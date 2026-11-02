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
 assert.equal(describe('C16L_FPGA_V9.16.13.0.bin'),null);
 assert.equal(describe('unknown.bin'),null);
});
