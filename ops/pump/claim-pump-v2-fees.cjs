#!/usr/bin/env node
process.argv.push('--mode','pump-v2');
require('./claim-fees.cjs');
