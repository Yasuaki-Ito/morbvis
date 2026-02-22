#!/usr/bin/env node
/**
 * Sync version from package.json to tauri.conf.json and Cargo.toml
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')).version;

// tauri.conf.json
const tauriConfPath = resolve(root, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// Cargo.toml
const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf-8');
cargo = cargo.replace(/^version\s*=\s*".*"/m, `version = "${version}"`);
writeFileSync(cargoPath, cargo);

console.log(`Version synced: ${version}`);
