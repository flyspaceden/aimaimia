import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = new URL('../../', import.meta.url)
const license = await readFile(new URL('./LUNAR_LICENSE.txt', import.meta.url), 'utf8')
await build({ entryPoints: [fileURLToPath(new URL('./entry.ts', import.meta.url))], outfile: fileURLToPath(new URL('huahai-corporate-site/assets/farming-calendar.js', root)), bundle: true, minify: true, format: 'iife', target: ['es2020'], charset: 'utf8', tsconfigRaw: { compilerOptions: { target: 'ES2020' } }, banner: { js: `/*! lunar-typescript 1.8.6\n${license}\n*/` }, legalComments: 'eof' })
const sources = {}
for (const name of ['screenCalendar.ts', 'agriculturalCalendarContent.ts']) sources[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')
await writeFile(new URL('huahai-corporate-site/assets/farming-calendar-manifest.json', root), JSON.stringify({ version: '20261010-v1', lunarTypescript: '1.8.6', sources }, null, 2) + '\n')
