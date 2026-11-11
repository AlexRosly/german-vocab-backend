#!/usr/bin/env node
// Extracts an encrypted-archive download; never connects to or restores a database.
const fs = require('node:fs'), path = require('node:path');
const { privateRoot, verifyExport, names } = require('./backup-offsite.cjs');
function unpack(input, directory, host) {
  if (!path.isAbsolute(input) || !path.isAbsolute(directory) || fs.existsSync(directory)) throw Error('Use an absolute input path and a NEW private output directory');
  const bundle = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (bundle.version !== 1 || !bundle.files || JSON.stringify(Object.keys(bundle.files).sort()) !== JSON.stringify([...names].sort()) || names.some(n => typeof bundle.files[n] !== 'string')) throw Error('Unexpected backup bundle format');
  const destination = privateRoot(directory);
  for (const name of names) fs.writeFileSync(path.join(destination, name), bundle.files[name], { flag: 'wx', mode: 0o600 });
  const verified = verifyExport(destination, host);
  return { directory: destination, counts: verified.counts, filesAndTableHashesVerified: true, databaseRestored: false };
}
module.exports = { unpack };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) { if (!['--input', '--directory', '--expect-host'].includes(args[i]) || !args[i + 1]) throw Error(); options[args[i]] = args[i + 1]; }
    if (!options['--expect-host']) throw Error();
    console.log(JSON.stringify(unpack(options['--input'], options['--directory'], options['--expect-host'])));
  } catch { console.error('Archive extraction refused. Check format, host, hashes, permissions and a new output directory; private details were not printed.'); process.exitCode = 1; }
}
