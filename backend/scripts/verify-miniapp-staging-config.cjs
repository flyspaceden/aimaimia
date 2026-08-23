#!/usr/bin/env node

process.env.MINIAPP_CONFIG_PROFILE = 'staging';
require('./verify-miniapp-config.cjs');
