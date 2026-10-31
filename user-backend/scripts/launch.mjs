#!/usr/bin/env node

const [mode, target] = process.argv.slice(2)

if (!['development', 'production'].includes(mode) || !target) {
  throw new Error('Usage: launch.mjs <development|production> <module>')
}

// Package scripts, not the caller's shell, own the runtime mode. In particular,
// `npm start` must never inherit development and expose provider test routes.
process.env.NODE_ENV = mode

await import(new URL(target, import.meta.url).href)
