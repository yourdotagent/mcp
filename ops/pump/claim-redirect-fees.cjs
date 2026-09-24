#!/usr/bin/env node
process.argv.push('--mode','redirect');
require('./claim-fees.cjs');
