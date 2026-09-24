#!/usr/bin/env node
process.argv.push('--mode','amm');
require('./claim-fees.cjs');
