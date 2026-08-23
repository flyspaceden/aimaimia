#!/usr/bin/env node

process.env.MINIAPP_CONFIG_PROFILE = 'production';
require('./verify-miniapp-config.cjs');
