#!/usr/bin/env node
/**
 * deaddeps giris noktasi.
 *
 * Kurulum sonrasi `npx deaddeps` / `deaddeps` komutu bu dosyayi calistirir.
 */

import { main } from '../src/cli.js';

const code = await main(process.argv.slice(2));
// stdout tamamen bosalmadan cikis yapilmali (pipe ile kullanim)
process.exitCode = code;

// Tum bekleyen yazma islemleri bitsin diye kisa bir bekleme yok:
// process.stdout.write senkron olmasa da Node cikis onunda flush eder.
